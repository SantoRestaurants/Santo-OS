from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

WORKFLOW_KEY = "xml_sat_validation"
REQUIRED_CONFIG_KEYS = ("rfc_map", "drive_folder_map", "trusted_source_exports")


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
    return [key for key in REQUIRED_CONFIG_KEYS if _has_unconfirmed_value(config.get(key))]


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _reject_unsafe_xml(xml_text: str) -> None:
    lowered = xml_text.lower()
    if "<!doctype" in lowered or "<!entity" in lowered:
        raise ValueError("Unsafe XML declarations are not allowed.")


def _parse_cfdi(xml_text: str) -> dict[str, Any]:
    _reject_unsafe_xml(xml_text)
    root = ET.fromstring(xml_text)
    parsed = {
        "version": root.attrib.get("Version") or root.attrib.get("version"),
        "issued_at": root.attrib.get("Fecha") or root.attrib.get("fecha"),
        "total": root.attrib.get("Total") or root.attrib.get("total"),
        "issuer_rfc": None,
        "receiver_rfc": None,
        "uuid": None,
    }

    for element in root.iter():
        name = _local_name(element.tag)
        if name == "Emisor":
            parsed["issuer_rfc"] = element.attrib.get("Rfc") or element.attrib.get("rfc")
        elif name == "Receptor":
            parsed["receiver_rfc"] = element.attrib.get("Rfc") or element.attrib.get("rfc")
        elif name == "TimbreFiscalDigital":
            parsed["uuid"] = element.attrib.get("UUID") or element.attrib.get("uuid")

    return parsed


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
        "check_key": "xml_sat_validation.local_parse",
        "status": status,
        "severity": severity,
        "message": message,
        "metadata": {},
        "checked_at": _now(),
    }


def _rfc_review_needed(parsed: dict[str, Any], rfc_map: dict[str, Any]) -> list[str]:
    allowed_rfcs = set(rfc_map.get("allowed_rfcs", []))
    if not allowed_rfcs:
        return ["rfc_map.allowed_rfcs"]

    missing = []
    for key in ("issuer_rfc", "receiver_rfc"):
        value = parsed.get(key)
        if not value or value not in allowed_rfcs:
            missing.append(key)

    return missing


def run(input_payload: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    payload = input_payload.get("payload", {})
    if not isinstance(payload, dict):
        payload = {}

    documents = payload.get("documents", [])
    if not isinstance(documents, list):
        documents = []

    dry_run = bool(input_payload.get("dry_run", True))
    missing_config = _missing_config(config)
    parsed_documents = []
    exceptions = []

    logging.info("xml_sat_validation_start document_count=%s dry_run=%s", len(documents), dry_run)

    if not documents:
        exceptions.append(
            {
                "exception_key": "missing_xml_documents",
                "exception_type": "missing_documents",
                "severity": "medium",
                "status": "requires_review",
                "details": {"missing": ["payload.documents"]},
            }
        )

    for index, document in enumerate(documents):
        if not isinstance(document, dict):
            continue

        document_key = document.get("document_key") or f"xml_document_{index + 1}"
        xml_text = document.get("xml_text")
        if _has_unconfirmed_value(xml_text):
            parsed_documents.append(
                {
                    "document_key": document_key,
                    "document_type": "xml_sat",
                    "source_system": document.get("source_system", "dashboard_upload"),
                    "source_uri": document.get("source_uri"),
                    "status": "requires_review",
                    "metadata": {"reason": "missing_xml_text"},
                }
            )
            exceptions.append(
                {
                    "exception_key": f"{document_key}_missing_xml_text",
                    "exception_type": "missing_xml_text",
                    "severity": "medium",
                    "status": "requires_review",
                    "details": {"document_key": document_key},
                }
            )
            continue

        try:
            parsed = _parse_cfdi(str(xml_text))
        except Exception as exc:
            parsed_documents.append(
                {
                    "document_key": document_key,
                    "document_type": "xml_sat",
                    "source_system": document.get("source_system", "dashboard_upload"),
                    "source_uri": document.get("source_uri"),
                    "status": "requires_review",
                    "metadata": {"reason": "xml_parse_error"},
                }
            )
            exceptions.append(
                {
                    "exception_key": f"{document_key}_xml_parse_error",
                    "exception_type": "xml_parse_error",
                    "severity": "medium",
                    "status": "requires_review",
                    "details": {"document_key": document_key, "error": str(exc)},
                }
            )
            continue

        rfc_missing = []
        if not missing_config:
            rfc_missing = _rfc_review_needed(parsed, config.get("rfc_map", {}))

        status = "requires_review" if missing_config or rfc_missing else "validated"
        parsed_documents.append(
            {
                "document_key": document_key,
                "document_type": "xml_sat",
                "source_system": document.get("source_system", "dashboard_upload"),
                "source_uri": document.get("source_uri"),
                "source_hash": document.get("source_hash"),
                "status": status,
                "metadata": parsed,
            }
        )

        if rfc_missing:
            exceptions.append(
                {
                    "exception_key": f"{document_key}_rfc_requires_review",
                    "exception_type": "rfc_requires_review",
                    "severity": "medium",
                    "status": "requires_review",
                    "details": {"document_key": document_key, "missing_or_unmapped": rfc_missing},
                }
            )

    if missing_config:
        exceptions.append(
            {
                "exception_key": "missing_xml_validation_config",
                "exception_type": "missing_config",
                "severity": "medium",
                "status": "requires_review",
                "details": {"missing": missing_config},
            }
        )

    status = "requires_review" if exceptions else "completed"
    idempotency_key = _stable_hash(
        {
            "workflow_key": WORKFLOW_KEY,
            "documents": [
                {
                    "document_key": item.get("document_key"),
                    "source_uri": item.get("source_uri"),
                    "source_hash": item.get("source_hash"),
                    "xml_text": item.get("xml_text"),
                }
                for item in documents
                if isinstance(item, dict)
            ],
        }
    )

    result = {
        "status": status,
        "workflow_key": WORKFLOW_KEY,
        "workflow_run": {
            "workflow_key": WORKFLOW_KEY,
            "status": status,
            "source_channel": input_payload.get("source_channel", "dashboard"),
            "idempotency_key": idempotency_key,
            "input_payload": payload,
            "config_snapshot": config,
            "requires_review_reason": ", ".join(missing_config) if missing_config else None,
        },
        "documents": parsed_documents,
        "tasks": [
            {
                "task_key": "validate_xml_metadata",
                "title": "Validate XML SAT metadata",
                "status": "requires_review" if exceptions else "completed",
                "metadata": {"document_count": len(parsed_documents)},
            }
        ],
        "exceptions": exceptions,
        "events": [
            _event("workflow_run.proposed", "info", {"workflow_key": WORKFLOW_KEY}),
            _event(
                "workflow_run.requires_review" if status == "requires_review" else "workflow_run.completed",
                "warning" if status == "requires_review" else "info",
                {"workflow_key": WORKFLOW_KEY},
            ),
        ],
        "watchdog_log": [
            _watchdog(
                "requires_review" if status == "requires_review" else "ok",
                "warning" if status == "requires_review" else "info",
                "XML SAT validation requires review."
                if status == "requires_review"
                else "XML SAT local validation completed.",
            )
        ],
        "dry_run": dry_run,
        "idempotency_key": idempotency_key,
    }

    logging.info("xml_sat_validation_end status=%s", status)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run XML SAT thin validation.")
    parser.add_argument("--input", required=True, help="Path to structured workflow input JSON.")
    parser.add_argument("--config", help="Path to XML SAT config JSON.")
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
        logging.exception("xml_sat_validation_failure")
        return 1


if __name__ == "__main__":
    sys.exit(main())
