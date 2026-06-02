"""
Utilities Receipt Matching — registers utility receipt metadata
(CFE, agua, gas) into workflow_runs and documents.

Thin workflow: just register, validate completeness, mark requires_review
if anything is missing. Never autonomously complete.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

WORKFLOW_KEY = "utility_receipts_matching"
REQUIRED_CONFIG_KEYS = ("providers", "reviewer_map", "drive_folder_map")
VALID_PROVIDERS = ("cfe", "agua", "gas")


def _json_dumps(data: dict[str, Any]) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _stable_hash(data: dict[str, Any]) -> str:
    return hashlib.sha256(_json_dumps(data).encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _load_json(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    with Path(path).open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    if not isinstance(loaded, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return loaded


def _has_unconfirmed_value(value: Any) -> bool:
    if value in (None, "", "[CONFIRM]"):
        return True
    if isinstance(value, str):
        return "[CONFIRM]" in value
    if isinstance(value, dict):
        return any(_has_unconfirmed_value(item) for item in value.values())
    if isinstance(value, list):
        return any(_has_unconfirmed_value(item) for item in value)
    return False


def _missing_config(config: dict[str, Any]) -> list[str]:
    missing = []
    for key in REQUIRED_CONFIG_KEYS:
        if _has_unconfirmed_value(config.get(key)):
            missing.append(key)
    return missing


def _event(event_type: str, severity: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "aggregate_type": "workflow_run",
        "aggregate_id": None,
        "event_type": event_type,
        "severity": severity,
        "payload": payload,
        "created_at": _now(),
    }


def _document_records(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = []
    for index, document in enumerate(documents):
        missing_hash = _has_unconfirmed_value(document.get("source_hash"))
        records.append({
            "document_key": document.get("document_key") or f"utility_doc_{index + 1}",
            "document_type": "utility_receipt",
            "source_system": document.get("source_system", "agent_mail"),
            "source_uri": document.get("source_uri"),
            "source_hash": None if missing_hash else document.get("source_hash"),
            "status": "requires_review" if missing_hash else "registered",
            "metadata": {
                "original_filename": document.get("filename"),
                "missing_source_hash": missing_hash,
            },
        })
    return records


def run(input_payload: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Process a utility receipt intake.

    Args:
        input_payload: Structured input with payload containing:
            - provider: CFE | agua | gas
            - amount: numeric amount
            - due_date: ISO date string
            - service_number: utility account number
            - documents: optional list of document metadata
        config: Workflow configuration.

    Returns:
        Structured result with workflow_run, documents, events, etc.
    """
    config = config or {}
    payload = input_payload.get("payload", {})
    if not isinstance(payload, dict):
        payload = {}

    dry_run = bool(input_payload.get("dry_run", True))
    provider = str(payload.get("provider", "")).lower().strip()
    amount = payload.get("amount")
    due_date = payload.get("due_date")
    service_number = payload.get("service_number")
    documents = payload.get("documents", [])
    if not isinstance(documents, list):
        documents = []

    idempotency_key = _stable_hash({
        "workflow_key": WORKFLOW_KEY,
        "provider": provider,
        "service_number": service_number,
        "due_date": due_date,
        "amount": amount,
    })

    logging.info(
        "utilities_intake_start provider=%s amount=%s due_date=%s dry_run=%s",
        provider,
        amount,
        due_date,
        dry_run,
    )

    # Validate
    missing_config = _missing_config(config)
    missing_payload: list[str] = []

    if not provider or provider not in VALID_PROVIDERS:
        missing_payload.append("payload.provider (must be cfe, agua, or gas)")
    if amount is None or amount == "":
        missing_payload.append("payload.amount")
    if _has_unconfirmed_value(due_date):
        missing_payload.append("payload.due_date")
    if _has_unconfirmed_value(service_number):
        missing_payload.append("payload.service_number")

    # Check that provider exists in config's provider list
    providers_config = config.get("providers", {})
    if provider and not _has_unconfirmed_value(providers_config):
        if provider not in providers_config:
            missing_payload.append(f"payload.provider ({provider} not in config)")

    document_records = _document_records([item for item in documents if isinstance(item, dict)])
    document_review_needed = any(r["status"] == "requires_review" for r in document_records)

    missing = missing_config + missing_payload
    status = "requires_review" if missing or document_review_needed else "registered"

    exceptions: list[dict[str, Any]] = []
    if missing:
        exceptions.append({
            "exception_key": "missing_utility_receipt_data",
            "exception_type": "missing_config",
            "severity": "medium",
            "status": "requires_review",
            "details": {"missing": missing},
        })

    tasks = [
        {
            "task_key": "register_utility_receipt",
            "title": f"Register utility receipt ({provider or 'unknown'})",
            "status": status,
            "metadata": {
                "provider": provider,
                "amount": amount,
                "due_date": due_date,
                "service_number": service_number,
            },
        },
    ]

    result = {
        "status": status,
        "workflow_key": WORKFLOW_KEY,
        "workflow_run": {
            "workflow_key": WORKFLOW_KEY,
            "business_date": due_date,
            "status": status,
            "source_channel": input_payload.get("source_channel", "agent_mail"),
            "idempotency_key": idempotency_key,
            "input_payload": payload,
            "config_snapshot": config,
            "requires_review_reason": ", ".join(missing) if missing else None,
        },
        "documents": document_records,
        "tasks": tasks,
        "exceptions": exceptions,
        "events": [
            _event(
                "workflow_run.proposed",
                "info",
                {"workflow_key": WORKFLOW_KEY, "provider": provider},
            ),
            _event(
                "workflow_run.requires_review" if status == "requires_review" else "workflow_run.registered",
                "warning" if status == "requires_review" else "info",
                {"workflow_key": WORKFLOW_KEY, "missing": missing},
            ),
        ],
        "dry_run": dry_run,
        "idempotency_key": idempotency_key,
    }

    logging.info("utilities_intake_end status=%s", status)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Utilities Receipt intake.")
    parser.add_argument("--input", required=True, help="Path to structured workflow input JSON.")
    parser.add_argument("--config", help="Path to Utilities config JSON.")
    parser.add_argument("--dry-run", action="store_true", help="Force dry_run=true.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        input_payload = _load_json(args.input)
        if args.dry_run:
            input_payload["dry_run"] = True
        config = _load_json(args.config)
        print(json.dumps(run(input_payload, config), indent=2, sort_keys=True))
        return 0
    except Exception:
        logging.exception("utilities_intake_failure")
        return 1


if __name__ == "__main__":
    sys.exit(main())
