"""Cron-safe scheduler bridge for the Corte Santo workflow.

Vercel Cron, GitHub Actions or a future worker can call this module. It stays
as a connector layer: workflow state still belongs in Supabase/Postgres and the
workflow logic remains in the existing Corte Santo modules.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timedelta, UTC
from pathlib import Path
from typing import Any

import importlib.util
from typing import Any

from services.agent_mail.poller import (
    DEFAULT_INBOX_ID,
    AgentMailClient,
    SupabaseWriter,
    _load_config,
    poll_and_classify,
)
from services.drive_connector.connector import build_drive_client
from services.drive_connector.corte_bank_watcher import poll_bank_folder_once
from services.business_time import business_today

logger = logging.getLogger(__name__)


DEFAULT_ROUTING_CONFIG = "services/agent_mail/config.json"
DEFAULT_CORTE_CONFIG = "workflows/corte_santo/fixtures/config_confirmed.json"


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _load_json(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    with Path(path).open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    if not isinstance(loaded, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return loaded


def _supabase_writer(write: bool) -> tuple[SupabaseWriter | None, str | None]:
    if not write:
        return None, None
    url = _env("SUPABASE_URL") or _env("NEXT_PUBLIC_SUPABASE_URL")
    key = _env("SUPABASE_SERVICE_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None, "supabase_credentials_missing"
    return SupabaseWriter(url=url, service_key=key), None


def run_agent_mail_once(
    *,
    config_path: str,
    write: bool,
    after: str | None = None,
    message_limit: int = 50,
    subject_contains: str | None = None,
    force_reprocess: bool = False,
) -> dict[str, Any]:
    api_key = _env("AGENTMAIL_API_KEY")
    if not api_key:
        return {"status": "requires_review", "requires_review_reason": "agentmail_api_key_missing"}

    supabase, reason = _supabase_writer(write)
    if reason:
        return {"status": "requires_review", "requires_review_reason": reason}

    client = AgentMailClient(
        api_key=api_key,
        inbox_id=_env("AGENTMAIL_INBOX_ID", DEFAULT_INBOX_ID),
    )
    routing_config = _load_config(config_path)
    drive_config_path = _env("GOOGLE_DRIVE_CONNECTOR_CONFIG")
    drive_config = _load_config(drive_config_path) if drive_config_path else None
    results = poll_and_classify(
        client,
        routing_config,
        supabase,
        drive_config=drive_config,
        after=after or _env("CORTE_SANTO_AGENTMAIL_AFTER") or None,
        message_limit=message_limit,
        subject_contains=subject_contains or _env("CORTE_SANTO_AGENTMAIL_SUBJECT_CONTAINS") or None,
        dry_run=not write,
        force_reprocess=force_reprocess,
    )
    reviewed = [
        item
        for item in results
        if item.get("email_message", {}).get("processing_status") == "requires_review"
    ]
    return {
        "status": "completed" if not reviewed else "requires_review",
        "processed_count": len(results),
        "requires_review_count": len(reviewed),
        "write_mode": "live" if write else "dry_run",
        "force_reprocess": force_reprocess,
        "message_limit": message_limit,
        "subject_contains": subject_contains,
        "results": results,
    }


def _bank_folder_id(config: dict[str, Any]) -> str:
    drive_runtime = config.get("drive_runtime") if isinstance(config.get("drive_runtime"), dict) else {}
    return (
        _env("CORTE_SANTO_BANK_UPLOAD_FOLDER_ID")
        or _env("CORTE_SANTO_DRIVE_FOLDER_ID")
        or str(drive_runtime.get("bank_upload_folder_id") or "").strip()
        or str(drive_runtime.get("root_folder_id") or "").strip()
    )


def _load_runtime():
    path = Path(__file__).resolve().parents[2] / "workflows" / "corte_santo" / "runtime.py"
    spec = importlib.util.spec_from_file_location("corte_santo_runtime", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("corte_santo_runtime_unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _find_income_register(output: Any) -> dict[str, Any]:
    """Recursively locate an ``income_register`` dict inside a stage-1 output."""
    if isinstance(output, dict):
        candidate = output.get("income_register")
        if isinstance(candidate, dict) and candidate:
            return candidate
        for value in output.values():
            found = _find_income_register(value)
            if found:
                return found
    elif isinstance(output, list):
        for item in output:
            found = _find_income_register(item)
            if found:
                return found
    return {}


def _load_stage1_run(
    writer: SupabaseWriter,
    supabase_url: str,
    restaurant_key: str,
    business_date: str,
) -> dict[str, Any] | None:
    """Fetch the most recent stage-1 Corte workflow_run output for this date."""
    import httpx
    service_key = _env("SUPABASE_SERVICE_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")
    if not service_key:
        return None
    resp = httpx.get(
        f"{supabase_url}/rest/v1/workflow_runs",
        params={
            "select": "id,output_payload,status",
            "business_date": f"eq.{business_date}",
            "source_channel": "eq.agent_mail",
            "order": "created_at.desc",
            "limit": "1",
        },
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
        timeout=15.0,
    )
    if resp.status_code >= 400:
        return None
    data = resp.json()
    if not isinstance(data, list) or not data:
        return None
    output = data[0].get("output_payload") or {}
    if not isinstance(output, dict):
        return None
    # Expose the full income_register so the bank stage can preserve cortesia/propinas.
    output["income_register"] = _find_income_register(output)
    output["run_id"] = data[0].get("id")
    return output


def _load_previous_pending_collections(
    supabase_url: str,
    restaurant_key: str,
    current_date: str,
) -> list[dict[str, Any]]:
    """Fetch pending collections from the most recent run of previous days (up to 30 days)."""
    import httpx
    from datetime import datetime, timedelta
    service_key = _env("SUPABASE_SERVICE_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")
    if not service_key:
        return []
        
    try:
        curr = datetime.strptime(current_date, "%Y-%m-%d").date()
    except ValueError:
        return []
        
    start_date = (curr - timedelta(days=30)).isoformat()
    
    resp = httpx.get(
        f"{supabase_url}/rest/v1/workflow_runs",
        params={
            "select": "id,business_date,output_payload,status",
            "business_date": f"lt.{current_date}",
            "source_channel": "eq.agent_mail",
            "order": "created_at.desc",
            "limit": "100",
        },
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
        timeout=15.0,
    )
    if resp.status_code >= 400:
        return []
        
    data = resp.json()
    if not isinstance(data, list):
        return []
        
    pending = []
    seen_dates = set()
    for row in data:
        bdate = row.get("business_date")
        if not bdate or bdate < start_date or bdate in seen_dates:
            continue
        seen_dates.add(bdate)
        
        output = row.get("output_payload") or {}
        
        # If bank stage was completed, get its pending items
        bank_result = output.get("bank_reconciliation") or (output.get("bank_stage") or {}).get("bank_reconciliation")
        if bank_result and isinstance(bank_result.get("pending_items"), list):
            pending.extend(bank_result["pending_items"])
            continue
            
        # Otherwise if stuck in stage 1, get expected_collections
        expected = output.get("expected_collections")
        if isinstance(expected, list):
            pending.extend(expected)
            
    return pending


def _build_expected_collections(
    runs: list[dict[str, Any]],
    effective_date: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], set[str]]:
    """Carry forward the latest cumulative bank ledger, then add newer Cortes.

    A bank snapshot is authoritative for every day up to its processing date. In
    particular, items absent from the snapshot's ``pending_items`` were matched
    and must not be reconstructed from the original income register on the next
    watcher run. Older daily bank payloads did not have a snapshot marker, so
    they remain a compatibility fallback only; new writes always persist the
    complete unmatched ledger in ``bank_processing_snapshot``.
    """
    normalized: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    for run in runs:
        business_date = str(run.get("business_date") or "")
        if not business_date or business_date > effective_date:
            continue
        output = run.get("output_payload") or {}
        if isinstance(output, str):
            try:
                output = json.loads(output)
            except Exception:
                continue
        if isinstance(output, dict):
            normalized.append((business_date, run, output))

    latest_snapshot_date = ""
    latest_snapshot_items: list[dict[str, Any]] | None = None
    latest_stage: dict[str, Any] = {}
    latest_output_date = ""
    latest_snapshot_key: tuple[str, str, str] | None = None
    has_authoritative_snapshot = False

    for business_date, run, output in normalized:
        if business_date >= latest_output_date:
            latest_output_date = business_date
            latest_stage = output

        snapshot = output.get("bank_processing_snapshot")
        if not isinstance(snapshot, dict):
            continue
        processed_on = str(snapshot.get("processed_on") or business_date)
        if not processed_on or processed_on > effective_date:
            continue

        raw_items = snapshot.get("pending_items")
        if not isinstance(raw_items, list):
            bank = output.get("bank_reconciliation") or {}
            raw_items = bank.get("pending_items") if isinstance(bank, dict) else None
        snapshot_items = [dict(item) for item in raw_items or [] if isinstance(item, dict)]
        snapshot_key = (
            processed_on,
            business_date,
            str(run.get("created_at") or ""),
        )
        if latest_snapshot_key is None or snapshot_key >= latest_snapshot_key:
            latest_snapshot_key = snapshot_key
            latest_snapshot_date = processed_on
            latest_snapshot_items = snapshot_items
            has_authoritative_snapshot = True

    # Compatibility for rows written before bank_processing_snapshot existed.
    # These rows may contain only a daily pending list, so they are never used
    # once an explicit cumulative snapshot is available.
    if not has_authoritative_snapshot:
        for business_date, _run, output in normalized:
            bank = output.get("bank_reconciliation") or {}
            pending_items = bank.get("pending_items") if isinstance(bank, dict) else None
            if isinstance(pending_items, list) and business_date >= latest_snapshot_date:
                latest_snapshot_date = business_date
                latest_snapshot_items = [dict(item) for item in pending_items if isinstance(item, dict)]

    expected: list[dict[str, Any]] = [
        _normalize_expected_collection(
            item,
            str(item.get("business_date") or item.get("source_date") or latest_snapshot_date),
        )
        for item in (latest_snapshot_items or [])
        if isinstance(item, dict)
    ]
    pending_runs: list[dict[str, Any]] = []
    seen_dates: set[str] = set()

    for business_date, run, output in normalized:
        # The latest snapshot already represents all prior open items.
        # An explicit reprocess of the snapshot's own business date must add
        # that date's newly captured Corte ledger again. Otherwise a previous
        # run for the same date would make the new day's Banorte/AMEX/platform
        # expectations disappear from the next reconciliation.
        reprocess_snapshot_date = (
            latest_snapshot_items is not None
            and business_date == effective_date == latest_snapshot_date
        )
        if latest_snapshot_items is not None and business_date <= latest_snapshot_date and not reprocess_snapshot_date:
            continue

        bank = output.get("bank_reconciliation") or {}
        revision = output.get("revision_document") or {}
        pending = (
            bank.get("pending_collections") if isinstance(bank, dict) else None
        ) or (
            revision.get("falta_por_entrar") if isinstance(revision, dict) else None
        ) or {}
        marked_validated = (
            output.get("bank_validation_status") == "bank_validated"
            or output.get("stage") == "bank_validated"
            or (isinstance(bank, dict) and bank.get("status") == "bank_validated")
        )
        if marked_validated and not pending:
            continue

        register = output.get("income_register") or {}
        if not register:
            workflow_run = (output.get("workflow_result") or {}).get("workflow_run") or {}
            candidate = (workflow_run.get("canonical_evidence") or {}).get("income_register") or {}
            if isinstance(candidate, dict):
                register = candidate
        if not isinstance(register, dict) or business_date in seen_dates:
            continue

        seen_dates.add(business_date)
        expected.extend(_expected_collections_from_output(output, business_date))
        pending_runs.append({
            "id": run["id"],
            "business_date": business_date,
            "income_channels": register,
            "income_register": register,
            "revision_document": output.get("revision_document"),
            "output_payload": output,
        })

    # Legacy daily bank writes could retain only the newest platform row. Union
    # older item-level pending rows back into the expected ledger; reconciliation
    # will remove any row proven settled by the current statement.
    expected.extend(
        _legacy_platform_pending_items(
            normalized,
            latest_snapshot_items,
            latest_stage,
            effective_date,
            authoritative_snapshot=has_authoritative_snapshot,
        )
    )

    # Keep all runs available for historical status updates and snapshot writes.
    by_date = {item["business_date"]: item for item in pending_runs}
    for business_date, run, output in normalized:
        by_date.setdefault(business_date, {
            "id": run["id"],
            "business_date": business_date,
            "income_channels": output.get("income_channels") or {},
            "income_register": output.get("income_register") or {},
            "revision_document": output.get("revision_document"),
            "output_payload": output,
        })

    # Deduplicate expected collections
    unique_expected = []
    seen_expected = set()
    for item in expected:
        sd = str(item.get("source_date") or item.get("business_date"))
        # We also want to prefer items that have a 'status' if there are duplicates with and without status
        key = (sd, str(item.get("channel", "")), round(float(item.get("expected_deposit", item.get("amount", 0))), 2))
        if key not in seen_expected:
            seen_expected.add(key)
            unique_expected.append(item)
        else:
            # If the new item has a status and the old one didn't, replace it
            if item.get("status") and not next((x for x in unique_expected if x.get("source_date") == sd and x.get("channel") == item.get("channel") and round(float(x.get("expected_deposit", x.get("amount", 0))), 2) == key[2]), {}).get("status"):
                for idx, x in enumerate(unique_expected):
                    if x.get("source_date") == sd and x.get("channel") == item.get("channel") and round(float(x.get("expected_deposit", x.get("amount", 0))), 2) == key[2]:
                        unique_expected[idx] = item
                        break

    return unique_expected, list(by_date.values()), latest_stage, seen_dates


def _to_money(value: Any) -> float:
    if value in (None, "", "-"):
        return 0.0
    if isinstance(value, (int, float)):
        return round(float(value), 2)
    try:
        return round(float(str(value).replace("$", "").replace(",", "").strip()), 2)
    except ValueError:
        return 0.0


def _normalize_expected_collection(item: dict[str, Any], business_date: str) -> dict[str, Any]:
    amount = _to_money(item.get("amount", item.get("expected_deposit", 0)))
    expected_deposit = _to_money(item.get("expected_deposit", amount))
    source_date = str(item.get("source_date") or item.get("business_date") or business_date)
    channel = str(item.get("channel") or "unclassified").lower()
    if channel in ("terminal", "terminal_banorte"):
        channel = "banorte"
    if channel in ("plataforma", "plataformas", "uber_eats", "ubereats"):
        channel = "uber"
    return {
        **item,
        "business_date": str(item.get("business_date") or source_date),
        "source_date": source_date,
        "channel": channel,
        "amount": amount,
        "expected_deposit": expected_deposit,
    }


def _expected_collections_from_output(output: dict[str, Any], business_date: str) -> list[dict[str, Any]]:
    """Build the bank-stage ledger for one Corte day.

    The initial Corte run persists AMEX in ``expected_collections``.  The bank
    watcher carries those rows forward and adds day-level Banorte/platform
    expectations from the canonical income register.  Cash and tips are not
    future bank deposits, so they are intentionally excluded.
    """
    raw_expected = output.get("expected_collections")
    if not isinstance(raw_expected, list):
        nested = output.get("corte_santo_initial_stage") or {}
        if isinstance(nested, dict):
            raw_expected = nested.get("expected_collections")

    allowed_channels = {"amex", "banorte", "uber", "rappi"}
    expected = []
    for item in (raw_expected or []):
        if not isinstance(item, dict):
            continue
        normalized = _normalize_expected_collection(item, business_date)
        if str(normalized.get("channel") or "") in allowed_channels:
            expected.append(normalized)
    channels = {str(item.get("channel") or "") for item in expected}

    register = output.get("income_register") or {}
    if not register:
        workflow_run = (output.get("workflow_result") or {}).get("workflow_run") or {}
        candidate = (workflow_run.get("canonical_evidence") or {}).get("income_register") or {}
        if isinstance(candidate, dict):
            register = candidate
    if not isinstance(register, dict):
        register = {}

    def add(channel: str, amount: float) -> None:
        if amount <= 0 or channel in channels:
            return
        channels.add(channel)
        expected.append({
            "business_date": business_date,
            "source_date": business_date,
            "channel": channel,
            "amount": amount,
            "expected_deposit": amount,
        })

    add("amex", _to_money(register.get("amex")))
    add("banorte", round(_to_money(register.get("debito")) + _to_money(register.get("credito")), 2))
    add("uber", _to_money(register.get("uber") if register.get("uber") is not None else register.get("uber_eats")))
    add("rappi", _to_money(register.get("rappi")))
    return expected


def _legacy_platform_pending_items(
    normalized: list[tuple[str, dict[str, Any], dict[str, Any]]],
    latest_snapshot_items: list[dict[str, Any]] | None,
    latest_stage: dict[str, Any],
    effective_date: str,
    *,
    authoritative_snapshot: bool = False,
) -> list[dict[str, Any]]:
    """Recover platform rows lost by pre-snapshot daily bank writes.

    Before ``bank_processing_snapshot`` was persisted, the daily Corte write
    could leave only that day's platform item in ``bank_reconciliation``.  A
    later watcher then treated that partial list as cumulative and dropped an
    older still-open Rappi/Uber row.  Keep the recovery limited to platform rows
    already recorded as pending in an earlier run. When a legacy aggregate
    proves that item rows are missing, an exact amount match against the daily
    platform sales can recover those rows too. The current bank statement
    remains responsible for proving whether any recovered row was settled.

    An explicit snapshot is authoritative and must not be broadened here.
    """
    if authoritative_snapshot or not latest_snapshot_items:
        return []
    if isinstance(latest_stage.get("bank_processing_snapshot"), dict):
        return []

    platform_channels = {"uber", "rappi"}
    if not any(str(item.get("channel") or "").lower() in platform_channels for item in latest_snapshot_items):
        return []

    recovered: list[dict[str, Any]] = []
    seen: set[tuple[str, str, float]] = set()
    for business_date, _run, output in normalized:
        if not business_date or business_date > effective_date:
            continue
        bank = output.get("bank_reconciliation") or {}
        pending_items = bank.get("pending_items") if isinstance(bank, dict) else None
        if not isinstance(pending_items, list):
            continue
        for raw_item in pending_items:
            if not isinstance(raw_item, dict):
                continue
            channel = str(raw_item.get("channel") or "").lower()
            if channel not in platform_channels:
                continue
            item = _normalize_expected_collection(raw_item, business_date)
            source_date = str(item.get("source_date") or item.get("business_date") or business_date)
            amount = _to_money(item.get("amount", item.get("expected_deposit", 0)))
            if not source_date or source_date > effective_date or amount <= 0:
                continue
            key = (channel, source_date, amount)
            if key in seen:
                continue
            seen.add(key)
            recovered.append(item)

    # Some legacy bank runs preserved the cumulative platform total in
    # ``bank_processing.pending_collections`` but lost one or more item rows.
    # Reconcile each historical aggregate at its own cutoff date so newer Corte
    # days do not mask an older missing row. Only exact cent-level combinations
    # are accepted; an unresolved gap is left for review rather than guessed.
    for run_date, _run, output in normalized:
        processing = output.get("bank_processing")
        if not isinstance(processing, dict):
            continue
        cutoff = str(processing.get("business_date") or run_date or "")
        if not cutoff or cutoff > effective_date:
            continue
        aggregate = processing.get("pending_collections")
        if not isinstance(aggregate, dict):
            continue
        for channel in platform_channels:
            target = _to_money(aggregate.get(channel))
            if target <= 0:
                continue
            represented = round(
                sum(
                    _to_money(item.get("amount", item.get("expected_deposit", 0)))
                    for item in recovered
                    if str(item.get("channel") or "").lower() == channel
                    and str(item.get("source_date") or item.get("business_date") or "") <= cutoff
                ),
                2,
            )
            gap = round(target - represented, 2)
            if gap <= 0:
                continue

            candidates: list[dict[str, Any]] = []
            for candidate_date, _candidate_run, candidate_output in normalized:
                if not candidate_date or candidate_date > cutoff:
                    continue
                register = candidate_output.get("income_register") or {}
                if not isinstance(register, dict):
                    continue
                amount = _to_money(register.get(channel))
                key = (channel, candidate_date, amount)
                if amount <= 0 or key in seen:
                    continue
                candidates.append({
                    "business_date": candidate_date,
                    "source_date": candidate_date,
                    "channel": channel,
                    "amount": amount,
                    "expected_deposit": amount,
                })

            candidates.sort(key=lambda item: str(item.get("source_date") or ""))
            chosen: list[dict[str, Any]] | None = None

            def find_exact(start: int, remaining_cents: int, selected: list[dict[str, Any]]) -> bool:
                nonlocal chosen
                if remaining_cents == 0:
                    chosen = list(selected)
                    return True
                if remaining_cents < 0:
                    return False
                for index in range(start, len(candidates)):
                    amount_cents = int(round(_to_money(candidates[index]["amount"]) * 100))
                    if amount_cents > remaining_cents:
                        continue
                    if find_exact(index + 1, remaining_cents - amount_cents, selected + [candidates[index]]):
                        return True
                return False

            find_exact(0, int(round(gap * 100)), [])
            if not chosen:
                continue
            for item in chosen:
                key = (channel, str(item["source_date"]), _to_money(item["amount"]))
                if key in seen:
                    continue
                seen.add(key)
                recovered.append(item)
    return recovered


def _summarize_pending(items: list[dict[str, Any]]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for item in items:
        base_channel = str(item.get("channel") or "unclassified")
        amount = _to_money(item.get("amount", item.get("expected_deposit", 0)))
        if amount <= 0:
            continue
            
        status = str(item.get("status") or "")
        label = base_channel
        
        if status == "fuera_de_rango":
            label = f"{base_channel}_fuera_de_rango"
            
        totals[label] = round(totals.get(label, 0) + amount, 2)
        
    return totals


def _normalize_pending_totals(
    items: list[dict[str, Any]],
    pending_collections: Any = None,
) -> dict[str, float]:
    """Normalize the cumulative outstanding snapshot by display channel.

    ``pending_collections`` is already cumulative through the bank-processing
    date.  Older payloads stored Banorte as separate ``debito`` and ``credito``
    keys, so fold those into one Banorte value without changing the other
    channels.
    """
    source = pending_collections if isinstance(pending_collections, dict) else _summarize_pending(items)
    totals: dict[str, float] = {}
    legacy_banorte = 0.0
    for raw_channel, raw_amount in source.items():
        amount = _to_money(raw_amount)
        if amount <= 0:
            continue
        channel = str(raw_channel or "unclassified").lower()
        if channel in ("debito", "credito", "terminal", "terminal_banorte"):
            legacy_banorte = round(legacy_banorte + amount, 2)
            continue
        if channel in ("plataforma", "plataformas", "uber_eats", "ubereats"):
            channel = "uber"
        if channel == "cxc":
            channel = "cxc"
        totals[channel] = round(totals.get(channel, 0.0) + amount, 2)
    if legacy_banorte > 0 and "banorte" not in totals:
        totals["banorte"] = legacy_banorte
    return totals


def _statement_date_key(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) >= 10 and text[4] == "-":
        return text[:10]
    parts = text[:10].split("/")
    if len(parts) == 3 and len(parts[2]) == 4:
        return f"{parts[2]}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"
    return text[:10]


def _latest_bank_snapshot(
    runs: list[dict[str, Any]],
    effective_date: str,
) -> dict[str, Any]:
    candidates: list[tuple[str, str, dict[str, Any]]] = []
    for run in runs:
        business_date = str(run.get("business_date") or "")
        if not business_date or business_date > effective_date:
            continue
        output = run.get("output_payload") or {}
        if isinstance(output, str):
            try:
                output = json.loads(output)
            except Exception:
                continue
        snapshot = output.get("bank_processing_snapshot") if isinstance(output, dict) else None
        if isinstance(snapshot, dict) and snapshot.get("processed_on"):
            candidates.append((business_date, str(snapshot.get("processed_on")), snapshot))
    if not candidates:
        return {}
    candidates.sort(key=lambda item: (item[0], item[1]))
    return candidates[-1][2]


def _bank_deposit_exclusion_keys(
    snapshot: dict[str, Any],
    deposits: list[dict[str, Any]],
    keys: list[str],
) -> set[str]:
    """Identify deposits already consumed by the last bank batch.

    New snapshots persist exact deposit identities. The date fallback keeps the
    behavior safe for older snapshots that predate this field: Banorte settles
    on the following operation date, so a snapshot for the 14th has already
    observed deposits through the 15th.
    """
    persisted = snapshot.get("processed_bank_deposit_keys")
    if isinstance(persisted, list) and persisted:
        return {str(key) for key in persisted if key}
    processed_on = str(snapshot.get("processed_on") or "")
    cutoff = _statement_date_key(snapshot.get("statement_observed_through"))
    if not cutoff and processed_on:
        try:
            cutoff = (datetime.strptime(processed_on, "%Y-%m-%d") + timedelta(days=1)).date().isoformat()
        except ValueError:
            cutoff = ""
    if not cutoff:
        return set()
    return {
        key
        for deposit, key in zip(deposits, keys)
        if _statement_date_key(deposit.get("operation_date")) <= cutoff
    }


def _historical_bank_dates(output: Any) -> set[str]:
    if not isinstance(output, dict):
        return set()
    dates: set[str] = set()
    per_day = output.get("falta_por_entrar_por_dia")
    if isinstance(per_day, dict):
        dates.update(str(date) for date in per_day if str(date))
    per_day_details = output.get("falta_por_entrar_detalle_por_dia")
    if isinstance(per_day_details, dict):
        dates.update(str(date) for date in per_day_details if str(date))
    snapshot = output.get("bank_processing_snapshot")
    if isinstance(snapshot, dict) and isinstance(snapshot.get("processed_dates"), list):
        dates.update(
            str(date)
            for date in snapshot["processed_dates"]
            if isinstance(date, str) and date
        )
    return dates


def _should_write_historical_bank_snapshot(
    output: Any,
    business_date: str,
) -> bool:
    """Write a date only when it has no persisted bank snapshot yet."""
    return business_date not in _historical_bank_dates(output)


def _merge_historical_outstanding(
    output: Any,
    dates: set[str],
    total: float,
) -> dict[str, float]:
    history: dict[str, float] = {}
    if isinstance(output, dict) and isinstance(output.get("falta_por_entrar_por_dia"), dict):
        for date, value in output["falta_por_entrar_por_dia"].items():
            if isinstance(date, str) and date:
                history[date] = round(_to_money(value), 2)
    for date in sorted(dates):
        if date not in history:
            history[date] = round(total, 2)
    return history


def _merge_historical_outstanding_details(
    output: Any,
    dates: set[str],
    pending_totals: dict[str, float],
) -> dict[str, dict[str, float]]:
    """Keep the first bank snapshot's channel breakdown for each business day."""
    history: dict[str, dict[str, float]] = {}
    if isinstance(output, dict) and isinstance(output.get("falta_por_entrar_detalle_por_dia"), dict):
        for date, value in output["falta_por_entrar_detalle_por_dia"].items():
            if isinstance(date, str) and date and isinstance(value, dict):
                history[date] = _normalize_pending_totals([], value)
    for date in sorted(dates):
        if date not in history:
            history[date] = dict(pending_totals)
    return history


def _pending_items_for_date(items: list[dict[str, Any]], business_date: str) -> list[dict[str, Any]]:
    return [
        item for item in items
        if str(item.get("business_date") or item.get("source_date") or "") == business_date
    ]


def _dates_from_bank_match(match: dict[str, Any]) -> set[str]:
    dates: set[str] = set()
    direct_date = str(match.get("business_date") or match.get("source_date") or "")
    if direct_date:
        dates.add(direct_date)
    for key in ("expected", "expected_group", "allocations"):
        value = match.get(key)
        values = value if isinstance(value, list) else [value]
        for item in values:
            if not isinstance(item, dict):
                continue
            date = str(item.get("business_date") or item.get("source_date") or "")
            if date:
                dates.add(date)
    return dates


def _set_banorte_balance(output: dict[str, Any], balance: Any) -> None:
    """Keep the latest Banorte statement balance even without an AMEX match."""
    if balance is None:
        return
    try:
        normalized = round(float(balance), 2)
    except (TypeError, ValueError):
        return
    saldos = output.get("saldos")
    if not isinstance(saldos, dict):
        saldos = {}
    saldos["banorte"] = normalized
    output["saldos"] = saldos


def _cxc_expected_collection(receivable: dict[str, Any]) -> dict[str, Any] | None:
    """Return a bank-ledger item only for a real CxC lifecycle row.

    Older Agent Mail runs incorrectly mirrored normal Corte channels into
    corte_receivables with evidence.kind=channel_sales. Those rows duplicate
    AMEX/Banorte/platform expectations and must never re-enter the bank ledger.
    """
    evidence = receivable.get("evidence") or {}
    if not isinstance(evidence, dict) or evidence.get("kind") == "channel_sales":
        return None
    principal = _to_money(receivable.get("principal")) - _to_money(receivable.get("settled_principal"))
    if principal <= 0:
        return None
    return {
        "business_date": receivable.get("opened_on"),
        "channel": "cxc",
        "amount": principal,
        "expected_deposit": principal,
        "source_date": receivable.get("opened_on"),
        "receivable_id": receivable.get("id"),
        "receivable_key": receivable.get("receivable_key"),
        "description": evidence.get("description"),
    }


def run_bank_watcher_once(
    *,
    config_path: str,
    restaurant_key: str,
    business_date: str | None,
) -> dict[str, Any]:
    config = _load_json(config_path)
    folder_id = _bank_folder_id(config)
    if not folder_id:
        return {
            "status": "requires_review",
            "requires_review_reason": "corte_santo_bank_upload_folder_missing",
        }
    effective_date = business_date or _env("CORTE_SANTO_BANK_WATCH_DATE")
    if not effective_date:
        return {
            "status": "requires_review",
            "requires_review_reason": "corte_santo_bank_business_date_missing",
        }
    drive, reason = build_drive_client()
    if reason or drive is None:
        return {
            "status": "requires_review",
            "requires_review_reason": reason or "google_drive_client_unavailable",
        }

    watcher = poll_bank_folder_once(
        drive,
        folder_id=folder_id,
        restaurant_key=restaurant_key,
        business_date=effective_date,
    )
    if watcher.get("status") != "triggered":
        return watcher

    # Read stage-1 output from Supabase to resume bank stage
    supabase, reason = _supabase_writer(write=True)
    if reason:
        return {
            "status": "requires_review",
            "requires_review_reason": reason,
            "watcher_result": watcher,
        }
    supabase_url = _env("SUPABASE_URL") or _env("NEXT_PUBLIC_SUPABASE_URL")
    service_key = _env("SUPABASE_SERVICE_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")

    # ── Load ALL pending Corte days (last 30 days) ──
    try:
        cutoff_date = datetime.strptime(effective_date, "%Y-%m-%d").date()
    except ValueError:
        cutoff_date = business_today()
    cutoff = (cutoff_date - timedelta(days=30)).isoformat()

    import httpx
    resp_all = httpx.get(
        f"{supabase_url}/rest/v1/workflow_runs",
        params={
            "select": "id,business_date,status,output_payload",
            "business_date": f"gte.{cutoff}",
            "source_channel": "eq.agent_mail",
            "order": "business_date.asc",
            "limit": "50",
        },
        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        timeout=30.0,
    )
    if resp_all.status_code >= 400:
        return {
            "status": "requires_review",
            "requires_review_reason": f"supabase_query_failed:{resp_all.status_code}",
            "watcher_result": watcher,
        }
    all_runs = resp_all.json()
    if not isinstance(all_runs, list) or not all_runs:
        return {
            "status": "requires_review",
            "requires_review_reason": "no_pending_runs_found",
            "watcher_result": watcher,
        }

    expected_cols, pending_runs, latest_stage1, seen_dates = _build_expected_collections(
        all_runs,
        effective_date,
    )

    # Remove any existing cxc items from the snapshot since we fetch fresh from DB
    expected_cols = [
        item for item in expected_cols 
        if not str(item.get("channel", "")).lower().startswith("cxc") 
        and "cxc" not in str(item.get("channel", "")).lower()
    ]

    # ── Fetch active receivables from DB ──
    resp_rx = httpx.get(
        f"{supabase_url}/rest/v1/corte_receivables",
        params={
            "select": "*",
            "status": "eq.open",
        },
        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        timeout=30.0,
    )
    active_receivables = resp_rx.json() if resp_rx.status_code < 400 else []
    if not isinstance(active_receivables, list):
        active_receivables = []
    if active_receivables:
        for rx in active_receivables:
            expected = _cxc_expected_collection(rx)
            if expected:
                expected_cols.append(expected)

    if not expected_cols and not pending_runs:
        return {
            "status": "requires_review",
            "requires_review_reason": "no_pending_amex_collections_found",
            "pending_runs_checked": len(all_runs),
            "watcher_result": watcher,
        }

    logging.info(
        "Bank watcher: %d pending days, %d expected bank collections",
        len(pending_runs), len(expected_cols),
    )

    # Download bank files locally
    drive, reason = build_drive_client()
    if reason or drive is None:
        return {
            "status": "requires_review",
            "requires_review_reason": reason or "google_drive_client_unavailable",
            "watcher_result": watcher,
        }
    import tempfile, hashlib
    from pathlib import Path

    temp_root = Path(tempfile.gettempdir()) / "santoos-bank-watcher" / hashlib.sha256(
        f"{restaurant_key}:{effective_date}".encode()
    ).hexdigest()[:16]
    temp_root.mkdir(parents=True, exist_ok=True)

    docs_by_type = {}
    for doc in watcher.get("command", {}).get("payload", {}).get("documents", []):
        doc_type = doc.get("document_type")
        file_id = doc.get("drive_file_id")
        filename = doc.get("filename", "bank_file")
        if doc_type and file_id:
            local_path = temp_root / filename
            try:
                local_path.write_bytes(drive.download(file_id))
                docs_by_type[doc_type] = {
                    **doc,
                    "source_path": str(local_path),
                }
            except Exception as exc:
                docs_by_type[doc_type] = {
                    **doc,
                    "source_path": None,
                    "download_error": str(exc),
                }

    missing_downloads = [
        key for key in ("amex_statement", "banorte_statement")
        if not docs_by_type.get(key, {}).get("source_path")
    ]
    if missing_downloads:
        return {
            "status": "requires_review",
            "requires_review_reason": f"bank_file_download_failed:{','.join(missing_downloads)}",
            "watcher_result": watcher,
        }

    # A statement file is usually cumulative. Keep only deposits that were
    # not consumed by the previous bank batch, otherwise an old Banorte row can
    # settle the same outstanding collection twice.
    from workflows.corte_santo.bank_statement_parser import (
        bank_statement_deposit_keys,
        parse_banorte_csv,
    )

    banorte_doc = docs_by_type.get("banorte_statement", {})
    tracked_banorte_statement = parse_banorte_csv(str(banorte_doc.get("source_path", "")), config)
    tracked_deposits = [
        item for item in (tracked_banorte_statement.get("deposits") or [])
        if isinstance(item, dict)
    ]
    tracked_deposit_keys = bank_statement_deposit_keys(tracked_deposits)
    previous_snapshot = _latest_bank_snapshot(all_runs, effective_date)
    excluded_deposit_keys = _bank_deposit_exclusion_keys(
        previous_snapshot,
        tracked_deposits,
        tracked_deposit_keys,
    )
    processed_bank_deposit_keys = set(
        str(key)
        for key in (previous_snapshot.get("processed_bank_deposit_keys") or [])
        if key
    )
    processed_bank_deposit_keys.update(tracked_deposit_keys)
    statement_observed_through = max(
        (_statement_date_key(item.get("operation_date")) for item in tracked_deposits),
        default="",
    )

    # Re-download workbooks from Drive using latest stage1 data
    drive_file_ids = latest_stage1.get("drive_file_ids") or {}
    workbook_paths: dict[str, str] = {}
    workbook_outputs: dict[str, str] = {}
    drive_workbooks_dir = temp_root / "drive_workbooks"
    outputs_dir = temp_root / "outputs"
    drive_workbooks_dir.mkdir(parents=True, exist_ok=True)
    outputs_dir.mkdir(parents=True, exist_ok=True)
    for key in ("ingresos", "forecast"):
        file_id = drive_file_ids.get(key) if isinstance(drive_file_ids, dict) else None
        if not file_id:
            continue
        local_path = drive_workbooks_dir / f"{key}.xlsx"
        try:
            local_path.write_bytes(drive.download(file_id))
            workbook_paths[key] = str(local_path)
            workbook_outputs[key] = str(outputs_dir / f"{key}-bank-validated.xlsx")
        except Exception as exc:
            return {
                "status": "requires_review",
                "requires_review_reason": f"workbook_download_failed:{key}:{type(exc).__name__}",
                "watcher_result": watcher,
            }

    config = _load_json(config_path)

    def _safe(val: Any, default: Any) -> Any:
        return val if val is not None else default

    bank_request = {
        "workflow_key": "corte_santo_daily_sales_reconciliation",
        "phase": "P0",
        "dry_run": not _env("SANTO_CRON_WRITE", "").strip().lower() in ("true", "1"),
        "source_channel": "scheduler",
        "payload": {
            "business_date": effective_date,
            "restaurant_key": restaurant_key,
            "documents": list(docs_by_type.values()),
            "income_channels": _safe(latest_stage1.get("income_channels"), {}),
            "income_register": _safe(latest_stage1.get("income_register"), {}),
            "expected_collections": expected_cols,
            "exclude_bank_deposit_keys": sorted(excluded_deposit_keys),
            "revision_document": _safe(latest_stage1.get("revision_document"), {}),
            "workbook_paths": workbook_paths or _safe(latest_stage1.get("workbook_paths"), {}),
            "workbook_outputs": workbook_outputs or _safe(latest_stage1.get("workbook_outputs"), {}),
            "drive_file_ids": _safe(latest_stage1.get("drive_file_ids"), {}),
        },
    }

    # Extract Banorte final balance
    banorte_balance = tracked_banorte_statement.get("final_balance")
    try:
        if banorte_balance is None and banorte_doc.get("source_path"):
            banorte_balance = parse_banorte_csv(str(banorte_doc["source_path"]), config).get("final_balance")
    except Exception:
        pass

    runtime = _load_runtime()
    result = runtime.run_bank_stage(bank_request, config)
    result["watcher_result"] = watcher
    result["pending_runs_checked"] = len(pending_runs)
    result["expected_collections_count"] = len(expected_cols)

    # ── Per-day: persist status AND write workbook to Drive ──
    bank_result = result.get("bank_reconciliation") or {}
    amex_matches = bank_result.get("amex_matches", [])
    general_matches = bank_result.get("matches", [])
    pending_items = [
        item for item in (bank_result.get("pending_items") or [])
        if isinstance(item, dict)
    ]
    pending_totals = _normalize_pending_totals(
        pending_items,
        bank_result.get("pending_collections"),
    )
    bank_result["pending_collections"] = pending_totals
    pending_total = round(sum(pending_totals.values()), 2)
    processed_dates = {
        str(item.get("business_date") or item.get("source_date") or "")
        for item in expected_cols
        if str(item.get("business_date") or item.get("source_date") or "")
    }
    processed_dates.update(
        str(item.get("business_date") or item.get("source_date") or "")
        for item in pending_items
        if str(item.get("business_date") or item.get("source_date") or "")
    )
    matches_by_date: dict[str, dict[str, Any]] = {}
    for match in [*amex_matches, *general_matches]:
        if not isinstance(match, dict):
            continue
        match_dates = _dates_from_bank_match(match)
        processed_dates.update(match_dates)
        for match_date in match_dates:
            matches_by_date.setdefault(match_date, match)

    # Each date records the cumulative outstanding state observed by this bank
    # batch. A later batch gets a new date; it must not rewrite prior dates.
    dates_to_write = {
        str(pr.get("business_date"))
        for pr in pending_runs
        if str(pr.get("business_date") or "") in processed_dates
        and _should_write_historical_bank_snapshot(
            pr.get("output_payload"),
            str(pr.get("business_date")),
        )
    }
    if effective_date in processed_dates:
        dates_to_write.add(effective_date)
    result["falta_por_entrar_por_dia"] = {
        bd: pending_total for bd in sorted(dates_to_write) if bd
    }
    result["falta_por_entrar_detalle_por_dia"] = {
        bd: dict(pending_totals) for bd in sorted(dates_to_write) if bd
    }
    pending_snapshot_items = [
        {key: value for key, value in item.items() if not str(key).startswith("_")}
        for item in pending_items
        if isinstance(item, dict)
    ]
    bank_processing_snapshot = {
        "processed_on": effective_date,
        "processed_dates": sorted(date for date in dates_to_write if date),
        # This is the carry-forward ledger for the next bank validation. It is
        # deliberately cumulative through ``effective_date``; it must not be
        # rebuilt from the selected Corte day's register alone.
        "pending_items": pending_snapshot_items,
        "pending_collections": dict(pending_totals),
        "falta_por_entrar_por_dia": result["falta_por_entrar_por_dia"],
        "falta_por_entrar_detalle_por_dia": result["falta_por_entrar_detalle_por_dia"],
        "falta_por_entrar": pending_totals,
        "falta_por_entrar_total": pending_total,
        "processed_bank_deposit_keys": sorted(processed_bank_deposit_keys),
        "statement_observed_through": statement_observed_through,
    }
    validated_dates: set[str] = set(dates_to_write)

    # Apply only bank-validated amounts to CxC. Exact matches close the row;
    # FIFO partial matches increase settled_principal but leave the residual open.
    matched_receivable_ids = set()
    receivable_allocations: dict[str, float] = {}
    receivables_by_id = {
        str(item.get("id")): item
        for item in active_receivables
        if isinstance(item, dict) and item.get("id")
    }
    
    for match in amex_matches:
        if match.get("receivable_id"):
            matched_receivable_ids.add(match["receivable_id"])
    
    for match in general_matches:
        expected = match.get("expected")
        if isinstance(expected, dict) and expected.get("receivable_id"):
            matched_receivable_ids.add(expected["receivable_id"])
        group = match.get("expected_group")
        if isinstance(group, list):
            for item in group:
                if isinstance(item, dict) and item.get("receivable_id"):
                    matched_receivable_ids.add(item["receivable_id"])
        allocations = match.get("allocations")
        if isinstance(allocations, list):
            for allocation in allocations:
                if not isinstance(allocation, dict) or not allocation.get("receivable_id"):
                    continue
                rid = str(allocation["receivable_id"])
                receivable_allocations[rid] = round(
                    receivable_allocations.get(rid, 0.0) + _to_money(allocation.get("amount")),
                    2,
                )

    if matched_receivable_ids:
        for rid in matched_receivable_ids:
            try:
                receivable = receivables_by_id.get(str(rid), {})
                principal = _to_money(receivable.get("principal"))
                httpx.patch(
                    f"{supabase_url}/rest/v1/corte_receivables?id=eq.{rid}",
                    json={
                        "status": "settled",
                        "settled_on": effective_date,
                        "settled_principal": principal,
                    },
                    headers={"apikey": service_key, "Authorization": f"Bearer {service_key}", "Content-Type": "application/json"},
                    timeout=10.0,
                )
            except Exception as exc:
                logging.exception("Failed to mark receivable %s as settled: %s", rid, exc)

    for rid, allocation in receivable_allocations.items():
        if rid in matched_receivable_ids:
            continue
        receivable = receivables_by_id.get(rid)
        if not receivable:
            continue
        principal = _to_money(receivable.get("principal"))
        settled = round(_to_money(receivable.get("settled_principal")) + allocation, 2)
        is_settled = settled >= principal
        try:
            httpx.patch(
                f"{supabase_url}/rest/v1/corte_receivables?id=eq.{rid}",
                json={
                    "settled_principal": min(settled, principal),
                    "status": "settled" if is_settled else "open",
                    "settled_on": effective_date if is_settled else None,
                },
                headers={"apikey": service_key, "Authorization": f"Bearer {service_key}", "Content-Type": "application/json"},
                timeout=10.0,
            )
        except Exception as exc:
            logging.exception("Failed to apply partial receivable settlement %s: %s", rid, exc)

    for bd in sorted(dates_to_write):
        if not bd:
            continue

        # Find this day's pending run data
        day_data = next((pr for pr in pending_runs if pr["business_date"] == bd), {})

        # Run bank_stage for this specific day to write Ingresos to Drive
        day_request = {
            "workflow_key": "corte_santo_daily_sales_reconciliation",
            "phase": "P0",
            "dry_run": not _env("SANTO_CRON_WRITE", "").strip().lower() in ("true", "1"),
            "source_channel": "scheduler",
            "payload": {
                "business_date": bd,
                "restaurant_key": restaurant_key,
                "documents": list(docs_by_type.values()),
                "income_channels": day_data.get("income_channels") or _safe(latest_stage1.get("income_channels"), {}),
                "income_register": day_data.get("income_register") or _safe(latest_stage1.get("income_register"), {}),
                "expected_collections": [e for e in expected_cols if e.get("business_date") == bd],
                "exclude_bank_deposit_keys": sorted(excluded_deposit_keys),
                "revision_document": day_data.get("revision_document") or _safe(latest_stage1.get("revision_document"), {}),
                "workbook_paths": workbook_paths,
                "workbook_outputs": workbook_outputs,
                "drive_file_ids": _safe(latest_stage1.get("drive_file_ids"), {}),
            },
        }
        try:
            runtime.run_bank_stage(day_request, config)
            logging.info("Wrote Ingresos for %s", bd)
        except Exception as exc:
            logging.exception("Failed to write Ingresos for %s: %s", bd, exc)

        # Persist validation status to Supabase
        for pr in pending_runs:
            if pr["business_date"] == bd:
                try:
                    # Only update status and bank fields, don't replace output_payload
                    r_upd = httpx.patch(
                        f"{supabase_url}/rest/v1/workflow_runs?id=eq.{pr['id']}",
                        json={
                            "status": "completed",
                        },
                        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}",
                                 "Content-Type": "application/json", "Prefer": "return=representation"},
                        timeout=10.0,
                    )
                    # Also patch output_payload to merge bank fields
                    # First get current output_payload
                    r_get = httpx.get(
                        f"{supabase_url}/rest/v1/workflow_runs?id=eq.{pr['id']}&select=output_payload",
                        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
                        timeout=10.0,
                    )
                    if r_get.status_code < 400:
                        data = r_get.json()
                        if isinstance(data, list) and data:
                            current_op = data[0].get("output_payload") or {}
                            if isinstance(current_op, str):
                                try: current_op = json.loads(current_op)
                                except: current_op = {}
                            current_op["bank_validation_status"] = (
                                "bank_requires_review" if pending_totals else "bank_validated"
                            )
                            current_op["stage"] = "bank_validated"
                            current_op["bank_validated_at"] = datetime.now(UTC).isoformat()
                            revision = current_op.get("revision_document") or {}
                            if isinstance(revision, dict):
                                revision["falta_por_entrar"] = pending_totals
                                revision["bank_validation_status"] = (
                                    "bank_requires_review" if pending_totals else "bank_validated"
                                )
                                current_op["revision_document"] = revision
                            current_op["bank_reconciliation"] = {
                                **bank_result,
                                "status": "bank_requires_review" if pending_totals else "bank_validated",
                                "matched_on_later_statement": True,
                                "processed_on": effective_date,
                            }
                            current_op["falta_por_entrar_por_dia"] = _merge_historical_outstanding(
                                current_op,
                                dates_to_write,
                                pending_total,
                            )
                            current_op["falta_por_entrar_detalle_por_dia"] = _merge_historical_outstanding_details(
                                current_op,
                                dates_to_write,
                                pending_totals,
                            )
                            current_op["bank_processing_snapshot"] = {
                                **bank_processing_snapshot,
                                "falta_por_entrar_por_dia": current_op["falta_por_entrar_por_dia"],
                                "falta_por_entrar_detalle_por_dia": current_op["falta_por_entrar_detalle_por_dia"],
                            }
                            _set_banorte_balance(current_op, banorte_balance)
                            match_for_day = matches_by_date.get(bd)
                            if match_for_day:
                                current_op["bank_match"] = {
                                    "validated_by": match_for_day.get("validated_by") or "bank_statement",
                                    "amex_cargo": match_for_day.get("amex_cargo") or match_for_day.get("amex_cargo_a"),
                                }
                            httpx.patch(
                                f"{supabase_url}/rest/v1/workflow_runs?id=eq.{pr['id']}",
                                json={"output_payload": current_op},
                                headers={"apikey": service_key, "Authorization": f"Bearer {service_key}",
                                         "Content-Type": "application/json"},
                                timeout=10.0,
                            )
                    logging.info("Validated %s via bank statement", bd)
                except Exception as exc:
                    logging.exception("Failed to persist validation for %s: %s", bd, exc)
                break

    result["validated_dates"] = sorted(validated_dates)
    result["validated_count"] = len(validated_dates)

    # Persist the bank snapshot on the run selected by the operator. This must
    # happen before returning; otherwise Drive is updated but Dashboard keeps
    # rendering the stale stage-1 payload.
    try:
        for pr in pending_runs:
            if pr["business_date"] == effective_date:
                response = httpx.get(
                    f"{supabase_url}/rest/v1/workflow_runs?id=eq.{pr['id']}&select=output_payload",
                    headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
                    timeout=10.0,
                )
                response.raise_for_status()
                rows = response.json()
                current_op = rows[0].get("output_payload") or {}
                if isinstance(current_op, str):
                    current_op = json.loads(current_op)
                revision = current_op.get("revision_document") or {}
                pending_collections = bank_result.get("pending_collections") or {}
                persisted_bank_status = (
                    "bank_validated"
                    if bank_result.get("status") == "bank_validated" and not pending_collections
                    else "bank_requires_review"
                )
                if isinstance(revision, dict):
                    revision["falta_por_entrar"] = pending_collections
                    revision["bank_validation_status"] = persisted_bank_status
                    current_op["revision_document"] = revision
                current_op["bank_reconciliation"] = bank_result
                current_op["falta_por_entrar_por_dia"] = _merge_historical_outstanding(
                    current_op,
                    dates_to_write,
                    pending_total,
                )
                current_op["falta_por_entrar_detalle_por_dia"] = _merge_historical_outstanding_details(
                    current_op,
                    dates_to_write,
                    pending_totals,
                )
                current_op["bank_processing_snapshot"] = {
                    **bank_processing_snapshot,
                    "falta_por_entrar_por_dia": current_op["falta_por_entrar_por_dia"],
                    "falta_por_entrar_detalle_por_dia": current_op["falta_por_entrar_detalle_por_dia"],
                }
                current_op["bank_validation_status"] = persisted_bank_status
                current_op["bank_validated_at"] = datetime.now(UTC).isoformat()
                _set_banorte_balance(current_op, banorte_balance)
                update = httpx.patch(
                    f"{supabase_url}/rest/v1/workflow_runs?id=eq.{pr['id']}",
                    json={"output_payload": current_op},
                    headers={
                        "apikey": service_key,
                        "Authorization": f"Bearer {service_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=10.0,
                )
                update.raise_for_status()
                logging.info("Persisted bank stage summary for %s", effective_date)
                break
    except Exception:
        logging.exception("Failed to persist bank stage summary")

    return result


def _clear_bank_validation_for_missing_documents(
    output: dict[str, Any],
    business_date: str | None,
) -> None:
    """Remove stale bank evidence when the selected day's statements are absent."""
    output.pop("bank_reconciliation", None)
    output.pop("bank_processing_snapshot", None)
    output.pop("bank_match", None)
    output.pop("bank_validated_at", None)
    output["bank_validation_status"] = "bank_pending_upload"
    output["stage"] = "corte_loaded"

    if business_date:
        history = output.get("falta_por_entrar_por_dia")
        if isinstance(history, dict):
            history.pop(business_date, None)
            if history:
                output["falta_por_entrar_por_dia"] = history
            else:
                output.pop("falta_por_entrar_por_dia", None)
        detail_history = output.get("falta_por_entrar_detalle_por_dia")
        if isinstance(detail_history, dict):
            detail_history.pop(business_date, None)
            if detail_history:
                output["falta_por_entrar_detalle_por_dia"] = detail_history
            else:
                output.pop("falta_por_entrar_detalle_por_dia", None)

    revision = output.get("revision_document")
    if isinstance(revision, dict):
        revision.pop("falta_por_entrar", None)
        revision["bank_validation_status"] = "bank_pending_upload"
        output["revision_document"] = revision

    saldos = output.get("saldos")
    if isinstance(saldos, dict) and "banorte" in saldos:
        saldos.pop("banorte", None)
        if saldos:
            output["saldos"] = saldos
        else:
            output.pop("saldos", None)


def _persist_bank_processing_outcome(business_date: str | None, result: dict[str, Any]) -> None:
    """Close the dashboard's visible bank-processing state for every outcome."""
    if not business_date or _env("SANTO_CRON_WRITE", "").strip().lower() not in ("true", "1"):
        return
    supabase_url = _env("SUPABASE_URL") or _env("NEXT_PUBLIC_SUPABASE_URL")
    service_key = _env("SUPABASE_SERVICE_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        return
    try:
        import httpx

        headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        response = httpx.get(
            f"{supabase_url}/rest/v1/workflow_runs",
            params={
                "business_date": f"eq.{business_date}",
                "source_channel": "eq.agent_mail",
                "select": "id,output_payload",
                "order": "created_at.desc",
                "limit": "1",
            },
            headers=headers,
            timeout=15.0,
        )
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list) or not rows:
            return
        output = rows[0].get("output_payload") or {}
        if isinstance(output, str):
            output = json.loads(output)
        if not isinstance(output, dict):
            output = {}
        previous = output.get("bank_processing") or {}
        if not isinstance(previous, dict):
            previous = {}
        result_status = str(result.get("status") or "requires_review")
        watcher_result = result.get("watcher_result")
        missing_bank_documents = (
            result_status == "waiting_for_input"
            or (
                isinstance(watcher_result, dict)
                and watcher_result.get("status") == "waiting_for_input"
            )
        )
        processing_status = (
            "waiting_for_input"
            if missing_bank_documents
            else "completed"
            if result_status in ("completed", "bank_validated", "bank_requires_review")
            else "requires_review"
        )
        if missing_bank_documents:
            _clear_bank_validation_for_missing_documents(output, business_date)
        bank = output.get("bank_reconciliation") or {}
        pending = bank.get("pending_collections") if isinstance(bank, dict) else {}
        output["bank_processing"] = {
            **previous,
            "status": processing_status,
            "completed_at": datetime.now(UTC).isoformat(),
            "result_status": result_status,
            "requires_review_reason": result.get("requires_review_reason"),
            "validated_count": result.get("validated_count"),
            "validated_dates": result.get("validated_dates") or [],
            "pending_collections": pending or {},
        }
        row_update: dict[str, Any] = {"output_payload": output}
        if missing_bank_documents:
            row_update["status"] = "waiting_for_input"
        update = httpx.patch(
            f"{supabase_url}/rest/v1/workflow_runs?id=eq.{rows[0]['id']}",
            json=row_update,
            headers={**headers, "Content-Type": "application/json"},
            timeout=15.0,
        )
        update.raise_for_status()
    except Exception:
        logging.exception("Failed to persist bank processing outcome for %s", business_date)


def run_all(args: argparse.Namespace) -> dict[str, Any]:
    jobs: list[dict[str, Any]] = []
    if args.job in ("agent-mail", "all"):
        jobs.append(
            {
                "job": "agent-mail",
                    "result": run_agent_mail_once(
                        config_path=args.routing_config,
                        write=args.write,
                        after=args.after,
                        message_limit=getattr(args, "message_limit", 50),
                        subject_contains=getattr(args, "subject_contains", None),
                        force_reprocess=args.force_reprocess,
                    ),
            }
        )
    if args.job in ("bank-watcher", "all"):
        bank_result = run_bank_watcher_once(
            config_path=args.corte_config,
            restaurant_key=args.restaurant_key,
            business_date=args.business_date,
        )
        _persist_bank_processing_outcome(args.business_date, bank_result)
        jobs.append(
            {
                "job": "bank-watcher",
                "result": bank_result,
            }
        )
    statuses = [job["result"].get("status") for job in jobs]
    status = (
        "completed"
        if statuses and all(item in ("completed", "waiting_for_input") for item in statuses)
        else "requires_review"
    )
    return {
        "status": status,
        "ran_at": business_today().isoformat(),
        "jobs": jobs,
    }


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    parser = argparse.ArgumentParser(description="Run Corte Santo scheduled jobs once.")
    parser.add_argument("--job", choices=("agent-mail", "bank-watcher", "all"), default="all")
    parser.add_argument("--routing-config", default=DEFAULT_ROUTING_CONFIG)
    parser.add_argument("--corte-config", default=DEFAULT_CORTE_CONFIG)
    parser.add_argument("--restaurant-key", default=_env("CORTE_SANTO_RESTAURANT_KEY", "santo"))
    parser.add_argument("--business-date")
    parser.add_argument("--after")
    parser.add_argument("--message-limit", type=int, default=50)
    parser.add_argument("--subject-contains")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--force-reprocess", action="store_true")
    args = parser.parse_args(argv)

    try:
        result = run_all(args)
        print(json.dumps(result, indent=2, default=str))
        return 0
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "requires_review",
                    "requires_review_reason": "corte_santo_cron_exception",
                    "error": str(exc),
                },
                indent=2,
            )
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
