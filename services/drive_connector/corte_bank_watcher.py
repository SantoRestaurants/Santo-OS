"""Detect the AMEX + Banorte pair that resumes a Corte Santo run."""

from __future__ import annotations

import unicodedata
from typing import Any


BANK_EXTENSIONS = (".CSV", ".XLS", ".XLSX")


def _normalize(text: str) -> str:
    value = str(text or "").strip().upper()
    value = "".join(
        ch for ch in unicodedata.normalize("NFD", value) if unicodedata.category(ch) != "Mn"
    )
    return " ".join(value.replace("_", " ").replace("-", " ").split())


def _extension(name: str) -> str:
    upper = name.upper()
    for ext in BANK_EXTENSIONS:
        if upper.endswith(ext):
            return ext
    return ""


def classify_bank_file(
    filename: str,
    mime_type: str | None = None,
    content_sample: bytes | str | None = None,
) -> str | None:
    normalized = _normalize(filename)
    ext = _extension(filename)
    if not ext:
        return None

    if any(token in normalized for token in ("AMEX", "AMERICAN EXPRESS")):
        return "amex_statement"
    if any(token in normalized for token in ("BANORTE", "BANCO", "ESTADO DE CUENTA", "MOVIMIENTOS")):
        return "banorte_statement"
    if ext == ".CSV":
        return "banorte_statement"
    if content_sample is not None:
        text = (
            content_sample.decode("latin-1", errors="ignore")
            if isinstance(content_sample, bytes)
            else str(content_sample)
        )
        sample = _normalize(text)
        if any(token in sample for token in ("AMERICAN EXPRESS", "FECHA DE PAGO", "MONTO DEL PAGO")):
            return "amex_statement"
        if any(token in sample for token in ("BANORTE", "DESCRIPCION", "DEPOSITOS", "RETIROS", "SALDO")):
            return "banorte_statement"
    return None


def detect_bank_stage_trigger(
    files: list[dict[str, Any]],
    *,
    restaurant_key: str,
    business_date: str,
) -> dict[str, Any]:
    # Pick most recent file per document_type
    best: dict[str, dict[str, Any]] = {}
    import logging
    logger = logging.getLogger(__name__)
    for item in files:
        if not isinstance(item, dict):
            continue
        document_type = classify_bank_file(
            str(item.get("name", "")),
            item.get("mimeType"),
            item.get("content_sample"),
        )
        if not document_type:
            continue
        candidate = {
            "document_type": document_type,
            "drive_file_id": item.get("id"),
            "filename": item.get("name"),
            "source_uri": item.get("webViewLink"),
            "modified_time": item.get("modifiedTime"),
        }
        existing = best.get(document_type)
        if existing is None or (candidate.get("modified_time") or "") > (existing.get("modified_time") or ""):
            best[document_type] = candidate
            logger.info("Bank file selected: %s -> %s (modified=%s)", document_type, candidate["filename"], candidate["modified_time"])

    missing = [key for key in ("amex_statement", "banorte_statement") if key not in best]
    if missing:
        return {
            "status": "waiting_for_input",
            "missing": missing,
            "documents": list(best.values()),
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
                "documents": list(best.values()),
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
    files = client.list_files(folder_id=folder_id)
    for item in files:
        if not isinstance(item, dict) or classify_bank_file(str(item.get("name", "")), item.get("mimeType")):
            continue
        if not str(item.get("name", "")).upper().endswith(BANK_EXTENSIONS) or not item.get("id"):
            continue
        try:
            item["content_sample"] = client.download(str(item["id"]))[:20000]
        except Exception:
            item["content_sample_error"] = "download_failed"
    return detect_bank_stage_trigger(
        files,
        restaurant_key=restaurant_key,
        business_date=business_date,
    )
