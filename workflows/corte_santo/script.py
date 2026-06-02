from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

WORKFLOW_KEY = "corte_santo_daily_sales_reconciliation"
REQUIRED_CONFIG_KEYS = (
    "restaurant_map",
    "drive_folder_map",
    "mandatory_attachments",
    "reviewer_map",
    "thresholds",
)

# Default reconciliation thresholds (can be overridden in config)
DEFAULT_THRESHOLDS = {
    "cash_tolerance": 500,
    "deposit_tolerance": 200,
}


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


def _missing_payload(payload: dict[str, Any]) -> list[str]:
    missing = []

    for key in ("business_date", "restaurant_key"):
        if _has_unconfirmed_value(payload.get(key)):
            missing.append(f"payload.{key}")

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


def _watchdog(status: str, severity: str, message: str) -> dict[str, Any]:
    return {
        "check_key": "corte_santo.intake",
        "status": status,
        "severity": severity,
        "message": message,
        "metadata": {},
        "checked_at": _now(),
    }


def _document_records(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = []

    for index, document in enumerate(documents):
        missing_hash = _has_unconfirmed_value(document.get("source_hash"))
        records.append(
            {
                "document_key": document.get("document_key") or f"document_{index + 1}",
                "document_type": document.get("document_type", "unclassified"),
                "source_system": document.get("source_system", "agent_mail"),
                "source_uri": document.get("source_uri"),
                "source_hash": None if missing_hash else document.get("source_hash"),
                "status": "requires_review" if missing_hash else "registered",
                "metadata": {
                    "original_filename": document.get("filename"),
                    "missing_source_hash": missing_hash,
                },
            }
        )

    return records


def reconcile(
    sales_total: float,
    bank_deposit: float,
    cash_count: float,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Reconcile Corte Santo figures against configurable thresholds.

    Compares sales_total against bank_deposit + cash_count, and checks
    individual tolerances for cash and deposit discrepancies.

    Args:
        sales_total: Total reported sales for the day.
        bank_deposit: Amount deposited at the bank.
        cash_count: Cash counted at close.
        config: Optional config with 'thresholds' key containing
                'cash_tolerance' and 'deposit_tolerance'.

    Returns:
        dict with:
            - status: "ready_for_approval" or "requires_review"
            - exceptions: list of any discrepancies found
            - summary: reconciliation summary data
    """
    config = config or {}
    thresholds_config = config.get("thresholds", {})

    # Use config thresholds or defaults
    if _has_unconfirmed_value(thresholds_config):
        thresholds_config = {}

    cash_tolerance = float(
        thresholds_config.get("cash_tolerance", DEFAULT_THRESHOLDS["cash_tolerance"])
    )
    deposit_tolerance = float(
        thresholds_config.get("deposit_tolerance", DEFAULT_THRESHOLDS["deposit_tolerance"])
    )

    # Calculate differences
    total_accounted = bank_deposit + cash_count
    overall_difference = abs(sales_total - total_accounted)
    cash_difference = abs(cash_count - (sales_total - bank_deposit))
    deposit_difference = abs(bank_deposit - (sales_total - cash_count))

    exceptions: list[dict[str, Any]] = []

    if cash_difference > cash_tolerance:
        exceptions.append({
            "exception_key": "cash_discrepancy",
            "exception_type": "reconciliation_discrepancy",
            "severity": "high" if cash_difference > cash_tolerance * 2 else "medium",
            "status": "requires_review",
            "details": {
                "type": "cash",
                "expected": sales_total - bank_deposit,
                "actual": cash_count,
                "difference": cash_difference,
                "tolerance": cash_tolerance,
            },
        })

    if deposit_difference > deposit_tolerance:
        exceptions.append({
            "exception_key": "deposit_discrepancy",
            "exception_type": "reconciliation_discrepancy",
            "severity": "high" if deposit_difference > deposit_tolerance * 2 else "medium",
            "status": "requires_review",
            "details": {
                "type": "deposit",
                "expected": sales_total - cash_count,
                "actual": bank_deposit,
                "difference": deposit_difference,
                "tolerance": deposit_tolerance,
            },
        })

    status = "requires_review" if exceptions else "ready_for_approval"

    logging.info(
        "corte_santo_reconcile status=%s sales=%.2f deposit=%.2f cash=%.2f diff=%.2f",
        status,
        sales_total,
        bank_deposit,
        cash_count,
        overall_difference,
    )

    return {
        "status": status,
        "summary": {
            "sales_total": sales_total,
            "bank_deposit": bank_deposit,
            "cash_count": cash_count,
            "total_accounted": total_accounted,
            "overall_difference": overall_difference,
            "thresholds": {
                "cash_tolerance": cash_tolerance,
                "deposit_tolerance": deposit_tolerance,
            },
        },
        "exceptions": exceptions,
        "reconciled_at": _now(),
    }


def run(input_payload: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    payload = input_payload.get("payload", {})
    if not isinstance(payload, dict):
        payload = {}

    dry_run = bool(input_payload.get("dry_run", True))
    business_date = payload.get("business_date")
    restaurant_key = payload.get("restaurant_key")
    legal_entity_key = payload.get("legal_entity_key")
    documents = payload.get("documents", [])
    if not isinstance(documents, list):
        documents = []

    idempotency_key = _stable_hash(
        {
            "workflow_key": WORKFLOW_KEY,
            "business_date": business_date,
            "restaurant_key": restaurant_key,
            "documents": [
                {
                    "document_key": item.get("document_key"),
                    "source_uri": item.get("source_uri"),
                    "source_hash": item.get("source_hash"),
                }
                for item in documents
                if isinstance(item, dict)
            ],
        }
    )

    logging.info(
        "corte_santo_intake_start business_date=%s restaurant_key=%s dry_run=%s",
        business_date,
        restaurant_key,
        dry_run,
    )

    missing_config = _missing_config(config)
    missing_payload = _missing_payload(payload)
    document_records = _document_records([item for item in documents if isinstance(item, dict)])
    document_review_needed = any(record["status"] == "requires_review" for record in document_records)
    missing = missing_config + missing_payload

    status = "requires_review" if missing or document_review_needed else "waiting_for_input"
    exceptions = []
    tasks = [
        {
            "task_key": "register_corte_evidence",
            "title": "Register Corte Santo evidence",
            "status": "requires_review" if document_review_needed else "completed",
            "metadata": {"document_count": len(document_records)},
        },
        {
            "task_key": "review_corte_intake_config",
            "title": "Review Corte Santo intake configuration",
            "status": "requires_review" if missing_config else "completed",
            "metadata": {"missing_config": missing_config},
        },
    ]

    if missing:
        exceptions.append(
            {
                "exception_key": "missing_corte_intake_config_or_payload",
                "exception_type": "missing_config",
                "severity": "medium",
                "status": "requires_review",
                "details": {"missing": missing},
            }
        )

    if document_review_needed:
        exceptions.append(
            {
                "exception_key": "document_requires_review",
                "exception_type": "document_requires_review",
                "severity": "medium",
                "status": "requires_review",
                "details": {"reason": "One or more documents are missing source_hash."},
            }
        )

    result = {
        "status": status,
        "workflow_key": WORKFLOW_KEY,
        "workflow_run": {
            "workflow_key": WORKFLOW_KEY,
            "business_date": business_date,
            "restaurant_key": restaurant_key,
            "legal_entity_key": legal_entity_key,
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
                {"workflow_key": WORKFLOW_KEY, "business_date": business_date},
            ),
            _event(
                "workflow_run.requires_review" if status == "requires_review" else "workflow_run.intake_ready",
                "warning" if status == "requires_review" else "info",
                {"workflow_key": WORKFLOW_KEY, "missing": missing},
            ),
        ],
        "watchdog_log": [
            _watchdog(
                "requires_review" if status == "requires_review" else "ok",
                "warning" if status == "requires_review" else "info",
                "Corte Santo intake requires review."
                if status == "requires_review"
                else "Corte Santo intake records are ready for persistence.",
            )
        ],
        "dry_run": dry_run,
        "idempotency_key": idempotency_key,
    }

    logging.info("corte_santo_intake_end status=%s", status)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Corte Santo intake.")
    parser.add_argument("--input", required=True, help="Path to structured workflow input JSON.")
    parser.add_argument("--config", help="Path to Corte Santo config JSON.")
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
        logging.exception("corte_santo_intake_failure")
        return 1


if __name__ == "__main__":
    sys.exit(main())
