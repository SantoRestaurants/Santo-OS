from __future__ import annotations

import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "script.py"
SPEC = importlib.util.spec_from_file_location("corte_santo_script", MODULE_PATH)
assert SPEC is not None
assert SPEC.loader is not None
corte_santo_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(corte_santo_script)

BASE_INPUT = {
    "workflow_key": "corte_santo_daily_sales_reconciliation",
    "phase": "P0",
    "dry_run": True,
    "source_channel": "agent_mail",
    "payload": {
        "business_date": "2026-05-27",
        "restaurant_key": "santo_unidad_1",
        "documents": [
            {
                "document_key": "daily_sales_report",
                "document_type": "daily_sales_report",
                "source_system": "agent_mail",
                "source_uri": "email://msg-corte-001/corte.xlsx",
                "source_hash": "hash-001",
            }
        ],
    },
}

CONFIRMED_CONFIG = {
    "workflow_key": "corte_santo_daily_sales_reconciliation",
    "restaurant_map": {"santo_unidad_1": {"display_name": "Santo Unidad 1"}},
    "drive_folder_map": {"santo_unidad_1": "drive-folder-1"},
    "mandatory_attachments": ["daily_sales_report"],
    "reviewer_map": {"default": "admin_ops"},
    "thresholds": {"cash_difference_medium": 0},
}


def test_missing_config_requires_review() -> None:
    result = corte_santo_script.run(BASE_INPUT, {})

    assert result["status"] == "requires_review"
    assert result["workflow_run"]["status"] == "requires_review"
    assert result["exceptions"][0]["exception_type"] == "missing_config"


def test_missing_restaurant_requires_review() -> None:
    payload = {
        **BASE_INPUT["payload"],
        "restaurant_key": "[CONFIRM]",
    }
    result = corte_santo_script.run({**BASE_INPUT, "payload": payload}, CONFIRMED_CONFIG)

    assert result["status"] == "requires_review"
    assert "payload.restaurant_key" in result["exceptions"][0]["details"]["missing"]


def test_confirmed_intake_prepares_records_without_reconciliation() -> None:
    result = corte_santo_script.run(BASE_INPUT, CONFIRMED_CONFIG)

    assert result["status"] == "waiting_for_input"
    assert result["workflow_run"]["business_date"] == "2026-05-27"
    assert result["documents"][0]["status"] == "registered"
    assert result["tasks"][0]["task_key"] == "register_corte_evidence"
    assert result["exceptions"] == []


def test_document_missing_hash_requires_review() -> None:
    document = {
        **BASE_INPUT["payload"]["documents"][0],
        "source_hash": "[CONFIRM]",
    }
    payload = {**BASE_INPUT["payload"], "documents": [document]}
    result = corte_santo_script.run({**BASE_INPUT, "payload": payload}, CONFIRMED_CONFIG)

    assert result["status"] == "requires_review"
    assert result["documents"][0]["status"] == "requires_review"
    assert result["exceptions"][0]["exception_type"] == "document_requires_review"


def test_idempotency_key_is_stable() -> None:
    first = corte_santo_script.run(BASE_INPUT, CONFIRMED_CONFIG)
    second = corte_santo_script.run(BASE_INPUT, CONFIRMED_CONFIG)

    assert first["idempotency_key"] == second["idempotency_key"]
