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
from datetime import date
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
    return output


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
    stage1 = _load_stage1_run(supabase, supabase_url, restaurant_key, effective_date)
    if stage1 is None:
        return {
            "status": "requires_review",
            "requires_review_reason": "stage1_workflow_run_not_found",
            "watcher_result": watcher,
        }

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

    # Re-download workbooks from Drive; stage-1 local paths are not valid here.
    drive_file_ids = stage1.get("drive_file_ids") or {}
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

    # Build resume request and run bank stage
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
            "income_channels": _safe(stage1.get("income_channels"), {}),
            "income_register": _safe(stage1.get("income_register"), {}),
            "expected_collections": _safe(stage1.get("expected_collections"), []),
            "revision_document": _safe(stage1.get("revision_document"), {}),
            "workbook_paths": workbook_paths or _safe(stage1.get("workbook_paths"), {}),
            "workbook_outputs": workbook_outputs or _safe(stage1.get("workbook_outputs"), {}),
            "drive_file_ids": _safe(stage1.get("drive_file_ids"), {}),
        },
    }

    runtime = _load_runtime()
    result = runtime.run_bank_stage(bank_request, config)
    result["watcher_result"] = watcher
    return result


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
        jobs.append(
            {
                "job": "bank-watcher",
                "result": run_bank_watcher_once(
                    config_path=args.corte_config,
                    restaurant_key=args.restaurant_key,
                    business_date=args.business_date,
                ),
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
        "ran_at": date.today().isoformat(),
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
        return 0 if result.get("status") in ("completed", "waiting_for_input") else 2
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
