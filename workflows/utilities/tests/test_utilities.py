from __future__ import annotations

from workflows.utilities.script import run


CONFIRMED_CONFIG = {
    "workflow_key": "utility_receipts_matching",
    "providers": {
        "cfe": {"name": "CFE", "service_number_pattern": "^\\d{12}$", "payment_method": "transfer"},
        "agua": {"name": "Agua", "service_number_pattern": "^\\d{10}$", "payment_method": "transfer"},
        "gas": {"name": "Gas Natural", "service_number_pattern": "^\\d{8}$", "payment_method": "transfer"},
    },
    "reviewer_map": {"default": "admin@example.com"},
    "drive_folder_map": {"utilities": "/receipts/utilities"},
}


def test_complete_payload_registers() -> None:
    payload = {
        "payload": {
            "provider": "cfe",
            "amount": 2450.00,
            "due_date": "2026-06-15",
            "service_number": "123456789012",
        },
    }
    result = run(payload, CONFIRMED_CONFIG)
    assert result["status"] == "registered"
    assert result["workflow_key"] == "utility_receipts_matching"
    assert result["exceptions"] == []


def test_missing_provider_requires_review() -> None:
    payload = {
        "payload": {
            "amount": 2450.00,
            "due_date": "2026-06-15",
            "service_number": "123456789012",
        },
    }
    result = run(payload, CONFIRMED_CONFIG)
    assert result["status"] == "requires_review"


def test_invalid_provider_requires_review() -> None:
    payload = {
        "payload": {
            "provider": "internet",
            "amount": 500.00,
            "due_date": "2026-06-15",
            "service_number": "ABC123",
        },
    }
    result = run(payload, CONFIRMED_CONFIG)
    assert result["status"] == "requires_review"


def test_missing_amount_requires_review() -> None:
    payload = {
        "payload": {
            "provider": "agua",
            "due_date": "2026-06-15",
            "service_number": "1234567890",
        },
    }
    result = run(payload, CONFIRMED_CONFIG)
    assert result["status"] == "requires_review"


def test_unconfirmed_config_requires_review() -> None:
    payload = {
        "payload": {
            "provider": "cfe",
            "amount": 2450.00,
            "due_date": "2026-06-15",
            "service_number": "123456789012",
        },
    }
    result = run(payload, {"providers": "[CONFIRM]", "reviewer_map": "[CONFIRM]", "drive_folder_map": "[CONFIRM]"})
    assert result["status"] == "requires_review"


def test_missing_document_hash_requires_review() -> None:
    payload = {
        "payload": {
            "provider": "gas",
            "amount": 800.00,
            "due_date": "2026-07-01",
            "service_number": "12345678",
            "documents": [{"filename": "recibo.pdf", "source_hash": None}],
        },
    }
    result = run(payload, CONFIRMED_CONFIG)
    assert result["status"] == "requires_review"
    assert any(
        e["exception_type"] != "missing_config"
        or "document" in str(e.get("details", ""))
        for e in result.get("exceptions", [])
    ) or any(d["status"] == "requires_review" for d in result["documents"])


def test_idempotency_is_stable() -> None:
    payload = {
        "payload": {
            "provider": "cfe",
            "amount": 2450.00,
            "due_date": "2026-06-15",
            "service_number": "123456789012",
        },
    }
    first = run(payload, CONFIRMED_CONFIG)
    second = run(payload, CONFIRMED_CONFIG)
    assert first["idempotency_key"] == second["idempotency_key"]
