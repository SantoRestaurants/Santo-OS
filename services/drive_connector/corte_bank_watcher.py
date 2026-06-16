"""Detect the AMEX + Banorte pair that resumes a Corte Santo run."""

from __future__ import annotations

from typing import Any


def classify_bank_file(filename: str) -> str | None:
    normalized = filename.upper()
    if "AMEX" in normalized and normalized.endswith((".XLS", ".XLSX", ".CSV")):
        return "amex_statement"
    if "BANORTE" in normalized and normalized.endswith((".CSV", ".XLS", ".XLSX")):
        return "banorte_statement"
    return None


def detect_bank_stage_trigger(
    files: list[dict[str, Any]],
    *,
    restaurant_key: str,
    business_date: str,
) -> dict[str, Any]:
    documents: dict[str, dict[str, Any]] = {}
    duplicates: list[str] = []
    for item in files:
        if not isinstance(item, dict):
            continue
        document_type = classify_bank_file(str(item.get("name", "")))
        if not document_type:
            continue
        if document_type in documents:
            duplicates.append(document_type)
        documents[document_type] = {
            "document_type": document_type,
            "drive_file_id": item.get("id"),
            "filename": item.get("name"),
            "source_uri": item.get("webViewLink"),
            "modified_time": item.get("modifiedTime"),
        }

    missing = [
        key for key in ("amex_statement", "banorte_statement") if key not in documents
    ]
    if duplicates:
        return {
            "status": "requires_review",
            "review_reason": "duplicate_bank_documents",
            "duplicates": duplicates,
            "documents": list(documents.values()),
        }
    if missing:
        return {
            "status": "waiting_for_input",
            "missing": missing,
            "documents": list(documents.values()),
        }
    return {
        "status": "triggered",
        "command": {
            "command_type": "workflow.resume",
            "phase": "P0",
            "source_channel": "system",
            "workflow_key": "corte_santo_daily_sales_reconciliation",
            "actor": {"id": "drive_bank_watcher", "role": "system"},
            "payload": {
                "stage": "bank_validation",
                "restaurant_key": restaurant_key,
                "business_date": business_date,
                "documents": list(documents.values()),
            },
        },
    }


def poll_bank_folder_once(
    client: Any,
    *,
    folder_id: str,
    restaurant_key: str,
    business_date: str,
) -> dict[str, Any]:
    return detect_bank_stage_trigger(
        client.list_files(folder_id=folder_id),
        restaurant_key=restaurant_key,
        business_date=business_date,
    )
