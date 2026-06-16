"""Agent Mail -> Corte Santo runtime bridge.

This module is intentionally a connector layer. Supabase remains the source of
truth; this bridge only turns a classified Agent Mail message into the structured
input expected by the existing Corte Santo workflow runtime.
"""

from __future__ import annotations

import hashlib
import importlib.util
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from services.drive_connector.connector import build_drive_client

WORKFLOW_KEY = "corte_santo_daily_sales_reconciliation"
SPANISH_MONTHS = {
    "ENERO": 1,
    "FEBRERO": 2,
    "MARZO": 3,
    "ABRIL": 4,
    "MAYO": 5,
    "JUNIO": 6,
    "JULIO": 7,
    "AGOSTO": 8,
    "SEPTIEMBRE": 9,
    "SETIEMBRE": 9,
    "OCTUBRE": 10,
    "NOVIEMBRE": 11,
    "DICIEMBRE": 12,
}


def _load_runtime():
    path = Path(__file__).resolve().parents[2] / "workflows" / "corte_santo" / "runtime.py"
    spec = importlib.util.spec_from_file_location("corte_santo_runtime", path)
    if spec is None or spec.loader is None:  # pragma: no cover - import guard
        raise RuntimeError("corte_santo_runtime_unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_json(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    with Path(path).open("r", encoding="utf-8") as handle:
        import json

        loaded = json.load(handle)
    if not isinstance(loaded, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return loaded


def _document_type(filename: str) -> str:
    normalized = filename.upper()
    if "SANTO CORTE" in normalized and normalized.endswith((".XLSX", ".XLS")):
        return "corte_excel"
    if "TIRA" in normalized:
        return "tira"
    if "BANCARIAS" in normalized or "BANCARIA" in normalized:
        return "bancarias"
    if "AMEX" in normalized and normalized.endswith((".JPG", ".JPEG", ".PNG")):
        return "amex"
    if "DETALLE" in normalized and "EFECTIVO" in normalized:
        return "detalle_efectivo"
    if "DESCUENTO" in normalized:
        return "discounts"
    return "email_attachment"


def _business_date(text: str) -> str | None:
    normalized = text.upper()
    iso = re.search(r"\b(20\d{2})-(\d{2})-(\d{2})\b", normalized)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"
    spanish = re.search(r"\b(\d{1,2})\s+([A-ZÁÉÍÓÚÑ]+)\s+(20\d{2})\b", normalized)
    if spanish:
        day = int(spanish.group(1))
        month_name = (
            spanish.group(2)
            .replace("Á", "A")
            .replace("É", "E")
            .replace("Í", "I")
            .replace("Ó", "O")
            .replace("Ú", "U")
        )
        month = SPANISH_MONTHS.get(month_name)
        if month:
            return f"{int(spanish.group(3)):04d}-{month:02d}-{day:02d}"
    return None


def _restaurant_key(text: str) -> str | None:
    return "santo" if "SANTO" in text.upper() else None


def _safe_filename(filename: str) -> str:
    return re.sub(r"[^A-Za-z0-9._ -]+", "_", filename).strip() or "attachment"


def _download_workbook_from_drive(file_id: str, target: Path) -> str | None:
    drive, reason = build_drive_client()
    if reason or drive is None:
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(drive.download(file_id))
    return str(target)


def _workbook_paths(work_dir: Path) -> tuple[dict[str, str], dict[str, str], dict[str, str], list[str]]:
    missing: list[str] = []
    drive_file_ids = {
        "ingresos": os.environ.get("CORTE_SANTO_INGRESOS_FILE_ID", "").strip(),
        "forecast": os.environ.get("CORTE_SANTO_FORECAST_FILE_ID", "").strip(),
    }
    paths = {
        "ingresos": os.environ.get("CORTE_SANTO_INGRESOS_PATH", "").strip(),
        "forecast": os.environ.get("CORTE_SANTO_FORECAST_PATH", "").strip(),
    }
    for key, file_id in drive_file_ids.items():
        if not paths.get(key) and file_id:
            downloaded = _download_workbook_from_drive(file_id, work_dir / "drive_workbooks" / f"{key}.xlsx")
            if downloaded:
                paths[key] = downloaded
    for key in ("ingresos", "forecast"):
        if not paths.get(key):
            missing.append(f"CORTE_SANTO_{key.upper()}_PATH_or_FILE_ID")
    outputs = {
        "ingresos": str(work_dir / "outputs" / "ingresos-corte-loaded.xlsx"),
        "forecast": str(work_dir / "outputs" / "forecast-corte-loaded.xlsx"),
    }
    return paths, outputs, drive_file_ids, missing


def run_corte_initial_from_message(
    *,
    client: Any,
    source_message: dict[str, Any],
    intake_result: dict[str, Any],
    routing_config: dict[str, Any],
    dry_run: bool,
) -> dict[str, Any]:
    """Download the classified Corte email evidence and run stage 1."""
    command = intake_result.get("command") or {}
    if command.get("workflow_key") != WORKFLOW_KEY:
        return {"status": "not_applicable"}

    message_id = source_message.get("message_id") or source_message.get("id")
    subject = str(source_message.get("subject") or "")
    business_date = _business_date(subject)
    restaurant_key = _restaurant_key(subject)
    if not message_id or not business_date or not restaurant_key:
        return {
            "status": "requires_review",
            "requires_review_reason": "corte_subject_missing_business_date_or_restaurant",
        }

    temp_root = Path(tempfile.gettempdir()) / "santoos-agentmail-corte" / hashlib.sha256(
        str(message_id).encode("utf-8")
    ).hexdigest()[:16]
    attachments_dir = temp_root / "attachments"
    attachments_dir.mkdir(parents=True, exist_ok=True)

    documents: list[dict[str, Any]] = []
    for attachment in source_message.get("attachments") or []:
        attachment_id = attachment.get("attachment_id")
        filename = str(attachment.get("filename") or "attachment")
        if not attachment_id:
            continue
        content = client.download_attachment(str(message_id), str(attachment_id))
        source_hash = hashlib.sha256(content).hexdigest()
        local_path = attachments_dir / _safe_filename(filename)
        local_path.write_bytes(content)
        document_type = _document_type(filename)
        documents.append(
            {
                "document_key": document_type,
                "document_type": document_type,
                "filename": filename,
                "source_system": "agent_mail",
                "source_uri": f"agentmail://{message_id}/{attachment_id}",
                "source_path": str(local_path),
                "source_hash": source_hash,
            }
        )

    paths, outputs, drive_file_ids, workbook_missing = _workbook_paths(temp_root)
    config_path = (
        routing_config.get("corte_santo_automation", {}).get("config_path")
        if isinstance(routing_config.get("corte_santo_automation"), dict)
        else None
    ) or os.environ.get("CORTE_SANTO_CONFIG_PATH", "workflows/corte_santo/fixtures/config_confirmed.json")
    config = _load_json(config_path)

    request = {
        "workflow_key": WORKFLOW_KEY,
        "phase": "P0",
        "dry_run": dry_run,
        "source_channel": "agent_mail",
        "payload": {
            "business_date": business_date,
            "restaurant_key": restaurant_key,
            "documents": documents,
            "workbook_paths": paths,
            "workbook_outputs": outputs,
            "drive_file_ids": drive_file_ids,
        },
    }
    if workbook_missing:
        return {
            "status": "requires_review",
            "requires_review_reason": "corte_workbook_sources_missing",
            "missing": workbook_missing,
            "request": request,
        }

    runtime = _load_runtime()
    result = runtime.run_initial_stage(request, config)
    result["agent_mail_message_id"] = message_id
    result["agent_mail_subject"] = subject
    result["artifact_dir"] = str(temp_root)
    result["executed_at"] = datetime.now(UTC).isoformat()
    return result
