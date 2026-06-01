from __future__ import annotations

import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "script.py"
FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "sample_cfdi.xml"
SPEC = importlib.util.spec_from_file_location("xml_sat_validation_script", MODULE_PATH)
assert SPEC is not None
assert SPEC.loader is not None
xml_sat_validation_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(xml_sat_validation_script)

XML_TEXT = FIXTURE_PATH.read_text(encoding="utf-8")

BASE_INPUT = {
    "workflow_key": "xml_sat_validation",
    "phase": "P0",
    "dry_run": True,
    "source_channel": "dashboard",
    "payload": {
        "documents": [
            {
                "document_key": "sample_cfdi",
                "filename": "sample_cfdi.xml",
                "source_system": "dashboard_upload",
                "source_uri": "fixture://sample_cfdi.xml",
                "source_hash": "hash-xml-001",
                "xml_text": XML_TEXT,
            }
        ]
    },
}

CONFIRMED_CONFIG = {
    "workflow_key": "xml_sat_validation",
    "rfc_map": {"allowed_rfcs": ["AAA010101AAA", "BBB010101BBB"]},
    "drive_folder_map": {"xml_sat_root": "drive-folder-xml"},
    "trusted_source_exports": {"miadminxml_fixture_status": "generated_placeholder"},
}


def test_missing_config_requires_review() -> None:
    result = xml_sat_validation_script.run(BASE_INPUT, {})

    assert result["status"] == "requires_review"
    assert result["exceptions"][-1]["exception_type"] == "missing_config"


def test_confirmed_config_parses_cfdi_metadata() -> None:
    result = xml_sat_validation_script.run(BASE_INPUT, CONFIRMED_CONFIG)

    assert result["status"] == "completed"
    assert result["documents"][0]["status"] == "validated"
    assert result["documents"][0]["metadata"]["uuid"] == "11111111-2222-3333-4444-555555555555"
    assert result["documents"][0]["metadata"]["issuer_rfc"] == "AAA010101AAA"


def test_unmapped_rfc_requires_review() -> None:
    config = {
        **CONFIRMED_CONFIG,
        "rfc_map": {"allowed_rfcs": ["AAA010101AAA"]},
    }
    result = xml_sat_validation_script.run(BASE_INPUT, config)

    assert result["status"] == "requires_review"
    assert result["exceptions"][0]["exception_type"] == "rfc_requires_review"


def test_invalid_xml_requires_review() -> None:
    payload = {
        "documents": [
            {
                **BASE_INPUT["payload"]["documents"][0],
                "xml_text": "<not-closed>",
            }
        ]
    }
    result = xml_sat_validation_script.run({**BASE_INPUT, "payload": payload}, CONFIRMED_CONFIG)

    assert result["status"] == "requires_review"
    assert result["exceptions"][0]["exception_type"] == "xml_parse_error"


def test_unsafe_doctype_requires_review() -> None:
    payload = {
        "documents": [
            {
                **BASE_INPUT["payload"]["documents"][0],
                "xml_text": "<!DOCTYPE foo><foo />",
            }
        ]
    }
    result = xml_sat_validation_script.run({**BASE_INPUT, "payload": payload}, CONFIRMED_CONFIG)

    assert result["status"] == "requires_review"
    assert result["exceptions"][0]["exception_type"] == "xml_parse_error"


def test_idempotency_key_is_stable() -> None:
    first = xml_sat_validation_script.run(BASE_INPUT, CONFIRMED_CONFIG)
    second = xml_sat_validation_script.run(BASE_INPUT, CONFIRMED_CONFIG)

    assert first["idempotency_key"] == second["idempotency_key"]
