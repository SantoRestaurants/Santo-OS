"""Cron-safe scheduler bridge for the Corte Santo workflow.

Vercel Cron, GitHub Actions or a future worker can call this module. It stays
as a connector layer: workflow state still belongs in Supabase/Postgres and the
workflow logic remains in the existing Corte Santo modules.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path
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


def run_agent_mail_once(*, config_path: str, write: bool, after: str | None = None) -> dict[str, Any]:
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
        dry_run=not write,
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

    # Full bank-stage execution needs the original stage-1 ledger persisted in
    # Supabase. Until that is wired, the scheduler exposes the resume command
    # and refuses to pretend the workflow is complete.
    return {
        "status": "requires_review",
        "requires_review_reason": "bank_resume_payload_persistence_missing",
        "watcher_result": watcher,
    }


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
    parser = argparse.ArgumentParser(description="Run Corte Santo scheduled jobs once.")
    parser.add_argument("--job", choices=("agent-mail", "bank-watcher", "all"), default="all")
    parser.add_argument("--routing-config", default=DEFAULT_ROUTING_CONFIG)
    parser.add_argument("--corte-config", default=DEFAULT_CORTE_CONFIG)
    parser.add_argument("--restaurant-key", default=_env("CORTE_SANTO_RESTAURANT_KEY", "santo"))
    parser.add_argument("--business-date")
    parser.add_argument("--after")
    parser.add_argument("--write", action="store_true")
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
