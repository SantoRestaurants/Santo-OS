from __future__ import annotations

import importlib.util
from pathlib import Path

WD = Path(__file__).resolve().parents[1]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, WD / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bank = _load("bank_statement_parser")
vision = _load("vision_extractor")


# --- bank statement parser ---------------------------------------------------

def test_banorte_classifies_settlement_and_spei() -> None:
    rows = [
        {"DESCRIPCIÓN": "REST SANTO HAND ROLL 08890734C", "DESCRIPCIÓN DETALLADA": "-", "DEPÓSITOS": "$121,558.62", "RETIROS": "-"},
        {"DESCRIPCIÓN": "A7AE50226E0C58EF", "DESCRIPCIÓN DETALLADA": "SPEI RECIBIDO ... UBR PAGOS MEXICO", "DEPÓSITOS": "$15,543.82", "RETIROS": "-"},
        {"DESCRIPCIÓN": "20260601...", "DESCRIPCIÓN DETALLADA": "SPEI ... AMERICAN EXPRESS COMPANY MEXICO", "DEPÓSITOS": "$16,138.42", "RETIROS": "-"},
        {"DESCRIPCIÓN": "COMISION 08890734C", "DESCRIPCIÓN DETALLADA": "-", "DEPÓSITOS": "-", "RETIROS": "$2,484.59"},
    ]
    res = bank.parse_banorte_rows(rows, {})
    assert res["status"] == "ok"
    assert res["deposits_by_source"]["banorte"] == 121558.62
    assert res["deposits_by_source"]["uber"] == 15543.82
    assert res["deposits_by_source"]["amex"] == 16138.42


def test_banorte_unclassified_deposit_requires_review() -> None:
    rows = [
        {"DESCRIPCIÓN": "DEPOSITO MISTERIOSO", "DESCRIPCIÓN DETALLADA": "sin pista", "DEPÓSITOS": "$5,000.00", "RETIROS": "-"},
    ]
    res = bank.parse_banorte_rows(rows, {})
    assert res["status"] == "requires_review"
    assert res["unclassified_deposits"][0]["amount"] == 5000.0


def test_banorte_domiciled_expense_captured() -> None:
    rows = [
        {"DESCRIPCIÓN": "PAGO SPOTIFY", "DESCRIPCIÓN DETALLADA": "DOMICILIACION", "DEPÓSITOS": "-", "RETIROS": "$199.00"},
    ]
    res = bank.parse_banorte_rows(rows, {})
    assert res["domiciled_expenses"][0]["amount"] == 199.0


def test_banorte_missing_file_requires_review() -> None:
    res = bank.parse_banorte_csv("does/not/exist.csv", {})
    assert res["status"] == "requires_review"
    assert res["review_reason"].startswith("file_not_found")


# --- vision extractor (safe degradation without API access) ------------------

def test_vision_unknown_document_type() -> None:
    res = vision.extract_document("not_a_doc", "x.jpg", {})
    assert res["status"] == "requires_review"
    assert res["review_reason"].startswith("unknown_document_type")


def test_vision_missing_api_key_requires_review() -> None:
    config = {"vision_extraction": {"model": "claude-x", "api_key_env": "DEFINITELY_UNSET_KEY_123"}}
    res = vision.extract_document("tira", "x.jpg", config)
    assert res["status"] == "requires_review"
    assert res["review_reason"] in ("vision_api_key_missing", "image_not_found:x.jpg")


def test_vision_model_not_configured_requires_review() -> None:
    res = vision.extract_document("tira", "x.jpg", {"vision_extraction": {}})
    assert res["status"] == "requires_review"
    assert res["review_reason"] == "vision_model_not_configured"


def test_vision_batch_status_aggregates() -> None:
    out = vision.extract_documents(
        [{"document_type": "tira", "image_path": "x.jpg"}],
        {"vision_extraction": {}},
    )
    assert out["status"] == "requires_review"
    assert out["documents"][0]["document_type"] == "tira"
