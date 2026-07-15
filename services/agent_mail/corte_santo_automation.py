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
from workflows.corte_santo.cxc import parse_cxc_events

WORKFLOW_KEY = "corte_santo_daily_sales_reconciliation"
GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder"
WORKBOOK_EXTENSIONS = (".XLSX", ".XLS")
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
MONTH_NAMES_BY_NUMBER = {value: key for key, value in SPANISH_MONTHS.items() if key != "SETIEMBRE"}


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


IMAGE_EXTENSIONS = (".JPG", ".JPEG", ".PNG", ".WEBP", ".HEIC", ".HEIF")


def _document_type_from_ocr(text: str) -> str:
    """Infer the Corte photo kind from OCR text when the filename is opaque.

    Weekly Corte packages sometimes arrive with UUID filenames. The image
    itself still contains stable labels such as AMEX, BANORTE or WANSOFT, so
    use those labels as a supporting signal. Ties and weak signals remain
    generic and are handled as review rather than guessed.
    """
    normalized = _normalize_label(text or "")
    if not normalized:
        return "email_attachment"

    scores = {
        "cxc": 0,
        "amex": 0,
        "bancarias": 0,
        "detalle_efectivo": 0,
        "tira": 0,
    }

    def add(document_type: str, *signals: str, weight: int = 1) -> None:
        scores[document_type] += sum(weight for signal in signals if signal in normalized)

    add("cxc", "CUENTA POR COBRAR", "AJUSTE DE CXC", "MOVIMIENTO CXC", "CXC", weight=4)
    add("amex", "AMERICAN EXPRESS", "AMEX", weight=4)
    add("bancarias", "BANORTE", "VANORTE", "BANCARIAS", "MASTERCARD", "MASTER CARD", weight=3)
    add(
        "detalle_efectivo",
        "EFECTIVO REAL",
        "CORTESIA",
        "CORTESIA DIRECCION",
        "DEPOSITO",
        "DIRECCION",
        weight=3,
    )
    add(
        "tira",
        "WANSOFT",
        "TIRA",
        "TOTALES GENERALES",
        "VENTAS POR FORMA",
        "FORMA DE PAGO",
        "PROPINA POR FORMA",
        "CXC POR FORMA",
        "CONTROL POR FORMA",
        "INFORMACION OPERATIVA",
        "VENTAS POR PLATILLOS",
        "TOTAL POR TIPO DE GRUPO",
        "VENTA BRUTA",
        "TOTAL BRUTO",
        "VENTAS POR FORMA DE PAGO",
        "TOTAL VENTAS",
        "TOTAL PROPINAS",
        "CONTROL POR FORMA PAGO",
        "REPORTE DE VENTAS",
        weight=2,
    )

    best_score = max(scores.values())
    if best_score < 3:
        return "email_attachment"
    best = [document_type for document_type, score in scores.items() if score == best_score]
    if len(best) != 1:
        return "email_attachment"
    second_score = sorted(scores.values(), reverse=True)[1]
    if best_score - second_score < 2:
        return "email_attachment"
    return best[0]


def _document_type(filename: str, *, ocr_text: str | None = None) -> str:
    normalized = filename.upper()
    if "SANTO CORTE" in normalized and normalized.endswith((".XLSX", ".XLS")):
        return "corte_excel"
    if "CONTROL MOVIMIENTOS" in normalized and normalized.endswith((".XLSX", ".XLS")):
        return "wansoft_system_close"
    if "TIRA" in normalized:
        return "tira"
    if "BANCARIAS" in normalized or "BANCARIA" in normalized:
        return "bancarias"
    if "AMEX" in normalized and normalized.endswith((".JPG", ".JPEG", ".PNG")):
        return "amex"
    if "DETALLE" in normalized and "EFECTIVO" in normalized:
        return "detalle_efectivo"
    if "CXC" in normalized:
        return "cxc"
    if "DESCUENTO" in normalized:
        return "discounts"
    if ocr_text:
        return _document_type_from_ocr(ocr_text)
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


def _is_image_attachment(filename: str, content_type: str | None = None) -> bool:
    return str(content_type or "").lower().startswith("image/") or str(filename).upper().endswith(IMAGE_EXTENSIONS)


def _is_probable_inline_signature(filename: str, content_type: str | None = None) -> bool:
    """Ignore the common Gmail signature image exposed as an attachment.

    AgentMail can flatten an inline Gmail signature into an attachment when a
    message is forwarded. It is not a Corte document and has no document
    label to classify, so it must not block the actual Corte photos.
    """
    return (
        str(filename).strip().lower() in {"image.png", "image.jpg", "image.jpeg"}
        and str(content_type or "").lower().startswith("image/")
    )


def _ocr_for_document_inference(path: Path, config: dict[str, Any]) -> str:
    """Read only enough OCR to classify an opaque photo filename."""
    try:
        from workflows.corte_santo import vision_extractor

        cfg = vision_extractor._vision_config(config)
        # Narrow/photographed receipts can produce very little text with the
        # configured block mode. A small set of alternate page segmentation
        # modes improves recall without making the workflow guess from the
        # attachment order or filename.
        texts: list[str] = []
        seen_psm: set[str] = set()
        for psm in (str(cfg.get("local_ocr_psm") or "6"), "11", "12", "3"):
            if psm in seen_psm:
                continue
            seen_psm.add(psm)
            ocr_cfg = dict(cfg)
            ocr_cfg["local_ocr_psm"] = psm
            text = vision_extractor._run_tesseract(path, ocr_cfg) or ""
            if text:
                texts.append(text)
        return "\n".join(texts)
    except (ImportError, OSError, RuntimeError, TypeError, ValueError):
        return ""


def _download_workbook_from_drive(file_id: str, target: Path) -> str | None:
    drive, reason = build_drive_client()
    if reason or drive is None:
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(drive.download(file_id))
    return str(target)


def _normalize_label(text: str) -> str:
    value = text.upper()
    replacements = {
        "Á": "A",
        "É": "E",
        "Í": "I",
        "Ó": "O",
        "Ú": "U",
        "Ñ": "N",
        "_": " ",
        "-": " ",
    }
    for before, after in replacements.items():
        value = value.replace(before, after)
    return " ".join(value.split())


def _list_drive_tree(client: Any, folder_id: str, *, max_depth: int = 2) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    seen: set[str] = set()

    def walk(current_folder_id: str, depth: int) -> None:
        if current_folder_id in seen or depth > max_depth:
            return
        seen.add(current_folder_id)
        for item in client.list_files(folder_id=current_folder_id):
            if not isinstance(item, dict):
                continue
            files.append(item)
            if item.get("mimeType") == GOOGLE_DRIVE_FOLDER_MIME and item.get("id"):
                walk(str(item["id"]), depth + 1)

    walk(folder_id, 0)
    return files


def _workbook_score(file: dict[str, Any], kind: str, business_date: str | None) -> int:
    name = _normalize_label(str(file.get("name") or ""))
    if not name.endswith(WORKBOOK_EXTENSIONS):
        return -1

    score = 0
    if kind == "ingresos":
        if "INGRESO" not in name:
            return -1
        score += 10
    elif kind == "forecast":
        forecast_tokens = ("FORECAST", " FC ", "PROYECCION", "PROYECCIONES", "META")
        padded = f" {name} "
        if not any(token in padded for token in forecast_tokens):
            return -1
        score += 10

    if business_date:
        try:
            year, month, _day = business_date.split("-")
            month_name = MONTH_NAMES_BY_NUMBER.get(int(month), "")
            if year in name:
                score += 3
            if month_name and month_name in name:
                score += 5
        except (ValueError, TypeError):
            pass
    return score


def _select_drive_workbook(
    files: list[dict[str, Any]],
    *,
    kind: str,
    business_date: str | None,
) -> tuple[dict[str, Any] | None, str | None]:
    target_month_name = ""
    target_year = ""
    if business_date:
        try:
            target_year, month, _day = business_date.split("-")
            target_month_name = MONTH_NAMES_BY_NUMBER.get(int(month), "")
        except (ValueError, TypeError):
            pass
    scored = [
        (_workbook_score(item, kind, business_date), item)
        for item in files
        if isinstance(item, dict)
    ]
    candidates = [(score, item) for score, item in scored if score >= 0]
    if target_month_name and target_year:
        exact_month = [
            (score, item) for score, item in candidates
            if target_month_name in _normalize_label(str(item.get("name") or ""))
            and target_year in _normalize_label(str(item.get("name") or ""))
        ]
        if not exact_month:
            return None, f"drive_{kind}_workbook_not_found_for_month:{business_date[:7]}"
        candidates = exact_month
    if not candidates:
        return None, f"drive_{kind}_workbook_not_found"
    candidates.sort(key=lambda pair: (pair[0], str(pair[1].get("modifiedTime") or "")), reverse=True)
    best_score = candidates[0][0]
    best = [item for score, item in candidates if score == best_score]
    if len(best) > 1 and str(best[0].get("modifiedTime") or "") == str(best[1].get("modifiedTime") or ""):
        return None, f"drive_{kind}_workbook_ambiguous"
    return candidates[0][1], None


def _discover_workbooks_from_drive_folder(
    work_dir: Path,
    *,
    business_date: str | None,
    config: dict[str, Any] | None = None,
) -> tuple[dict[str, str], dict[str, str], dict[str, str], list[str]]:
    config = config or {}
    drive_runtime = config.get("drive_runtime") if isinstance(config.get("drive_runtime"), dict) else {}
    folder_id = (
        os.environ.get("CORTE_SANTO_WORKBOOKS_FOLDER_ID", "").strip()
        or os.environ.get("CORTE_SANTO_DRIVE_FOLDER_ID", "").strip()
        or str(drive_runtime.get("workbooks_folder_id") or "").strip()
        or str(drive_runtime.get("root_folder_id") or "").strip()
    )
    if not folder_id:
        return {}, {}, {}, ["corte_santo_workbooks_folder_id_missing"]
    drive, reason = build_drive_client()
    if reason or drive is None:
        return {}, {}, {}, [reason or "google_drive_client_unavailable"]

    files = _list_drive_tree(drive, folder_id)
    paths: dict[str, str] = {}
    drive_file_ids: dict[str, str] = {}
    missing: list[str] = []
    for key in ("ingresos", "forecast"):
        selected, select_reason = _select_drive_workbook(files, kind=key, business_date=business_date)
        if select_reason or not selected:
            missing.append(select_reason or f"drive_{key}_workbook_not_found")
            continue
        file_id = str(selected.get("id") or "")
        if not file_id:
            missing.append(f"drive_{key}_workbook_missing_file_id")
            continue
        downloaded = _download_workbook_from_drive(file_id, work_dir / "drive_workbooks" / f"{key}.xlsx")
        if not downloaded:
            missing.append(f"drive_{key}_workbook_download_failed")
            continue
        paths[key] = downloaded
        drive_file_ids[key] = file_id
    outputs = {
        "ingresos": str(work_dir / "outputs" / "ingresos-corte-loaded.xlsx"),
        "forecast": str(work_dir / "outputs" / "forecast-corte-loaded.xlsx"),
    }
    return paths, outputs, drive_file_ids, missing


def _workbook_paths(
    work_dir: Path,
    business_date: str | None,
    config: dict[str, Any] | None = None,
) -> tuple[dict[str, str], dict[str, str], dict[str, str], list[str]]:
    missing: list[str] = []
    config = config or {}
    drive_runtime = config.get("drive_runtime") if isinstance(config.get("drive_runtime"), dict) else {}
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

    if not all(paths.get(key) for key in ("ingresos", "forecast")) and (
        os.environ.get("CORTE_SANTO_WORKBOOKS_FOLDER_ID", "").strip()
        or os.environ.get("CORTE_SANTO_DRIVE_FOLDER_ID", "").strip()
        or str(drive_runtime.get("workbooks_folder_id") or "").strip()
        or str(drive_runtime.get("root_folder_id") or "").strip()
    ):
        discovered_paths, _outputs, discovered_ids, discovered_missing = _discover_workbooks_from_drive_folder(
            work_dir,
            business_date=business_date,
            config=config,
        )
        for key, value in discovered_paths.items():
            if not paths.get(key):
                paths[key] = value
        for key, value in discovered_ids.items():
            drive_file_ids[key] = drive_file_ids.get(key) or value
        for reason in discovered_missing:
            if "ingresos" in reason and paths.get("ingresos"):
                continue
            if "forecast" in reason and paths.get("forecast"):
                continue
            missing.append(reason)

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
    body = str(source_message.get("body_text") or source_message.get("body") or "")
    business_date = _business_date(subject)
    restaurant_key = _restaurant_key(subject)
    if not message_id or not business_date or not restaurant_key:
        return {
            "status": "requires_review",
            "requires_review_reason": "corte_subject_missing_business_date_or_restaurant",
        }

    config_path = (
        routing_config.get("corte_santo_automation", {}).get("config_path")
        if isinstance(routing_config.get("corte_santo_automation"), dict)
        else None
    ) or os.environ.get("CORTE_SANTO_CONFIG_PATH", "workflows/corte_santo/fixtures/config_confirmed.json")
    config = _load_json(config_path)

    temp_root = Path(tempfile.gettempdir()) / "santoos-agentmail-corte" / hashlib.sha256(
        str(message_id).encode("utf-8")
    ).hexdigest()[:16]
    attachments_dir = temp_root / "attachments"
    attachments_dir.mkdir(parents=True, exist_ok=True)

    documents: list[dict[str, Any]] = []
    unclassified_images: list[str] = []
    for attachment in source_message.get("attachments") or []:
        attachment_id = attachment.get("attachment_id")
        filename = str(attachment.get("filename") or "attachment")
        if not attachment_id:
            continue
        if _is_probable_inline_signature(filename, attachment.get("content_type")):
            continue
        content = client.download_attachment(str(message_id), str(attachment_id))
        source_hash = hashlib.sha256(content).hexdigest()
        local_path = attachments_dir / _safe_filename(filename)
        local_path.write_bytes(content)
        document_type = _document_type(filename)
        if document_type == "email_attachment" and _is_image_attachment(
            filename, attachment.get("content_type")
        ):
            document_type = _document_type(
                filename,
                ocr_text=_ocr_for_document_inference(local_path, config),
            )
            if document_type == "email_attachment":
                unclassified_images.append(filename)
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

    paths, outputs, drive_file_ids, workbook_missing = _workbook_paths(
        temp_root,
        business_date,
        config,
    )

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
            "body_text": body,
            "cxc_events": parse_cxc_events(body),
        },
    }
    if workbook_missing:
        return {
            "status": "requires_review",
            "requires_review_reason": "corte_workbook_sources_missing",
            "missing": workbook_missing,
            "request": request,
        }

    if unclassified_images:
        return {
            "status": "requires_review",
            "requires_review_reason": "corte_image_classification_requires_review",
            "unclassified_images": unclassified_images,
            "request": request,
        }

    runtime = _load_runtime()
    result = runtime.run_initial_stage(request, config)
    result["agent_mail_message_id"] = message_id
    result["agent_mail_subject"] = subject
    result["artifact_dir"] = str(temp_root)
    result["executed_at"] = datetime.now(UTC).isoformat()
    return result
