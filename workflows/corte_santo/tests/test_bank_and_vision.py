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
script = _load("script")


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


def test_banorte_ignores_configured_non_operating_deposit() -> None:
    rows = [
        {
            bank.COL_DESC: "ABONO DCTO. CARTERA 0092247213",
            bank.COL_DESC_DETAIL: "-",
            bank.COL_DEPOSIT: "$7,000,000.00",
            bank.COL_WITHDRAWAL: "-",
        },
    ]
    res = bank.parse_banorte_rows(rows, {})
    assert res["status"] == "ok"
    assert res["ignored_deposits"][0]["amount"] == 7000000.0
    assert res["deposits"] == []


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


def test_vision_model_not_configured_requires_review(tmp_path: Path) -> None:
    image = tmp_path / "x.jpg"
    image.write_bytes(b"fake-image")
    res = vision.extract_document("tira", str(image), {"vision_extraction": {}})
    assert res["status"] == "requires_review"
    assert res["review_reason"] == "vision_model_not_configured"


def test_vision_batch_status_aggregates() -> None:
    out = vision.extract_documents(
        [{"document_type": "tira", "image_path": "x.jpg"}],
        {"vision_extraction": {}},
    )
    assert out["status"] == "requires_review"
    assert out["documents"][0]["document_type"] == "tira"


def test_amex_prompt_requires_summing_multiple_tickets() -> None:
    prompt = vision._build_prompt("amex")

    assert "mas de un ticket" in prompt
    assert "sumar todos los tickets visibles" in prompt
    assert "No sumes propina otra vez" in prompt


def test_vision_uses_success_cache(monkeypatch, tmp_path: Path) -> None:
    image = tmp_path / "amex.jpeg"
    image.write_bytes(b"fake-image")
    calls = []

    def fake_call(cfg, prompt, media_type, b64):
        calls.append((cfg, prompt, media_type, b64))
        return {
            "values": {"consumo": 100.0, "propina": 10.0, "total": 110.0},
            "confidence": 0.99,
            "notes": "ok",
        }

    monkeypatch.setenv("TEST_GEMINI_KEY", "key")
    monkeypatch.setattr(vision, "_call_gemini", fake_call)
    config = {
        "vision_extraction": {
            "provider": "gemini",
            "model": "gemini-test",
            "api_key_env": "TEST_GEMINI_KEY",
            "confidence_threshold": 0.9,
            "cache_enabled": True,
            "cache_dir": str(tmp_path / "cache"),
        }
    }

    first = vision.extract_document("amex", str(image), config, source_hash="hash-amex")
    second = vision.extract_document("amex", str(image), config, source_hash="hash-amex")

    assert first["status"] == "extracted"
    assert first["cache"] == "miss"
    assert second["status"] == "extracted"
    assert second["cache"] == "hit"
    assert len(calls) == 1


def test_local_ocr_amex_sums_total_lines_without_double_counting_tip() -> None:
    text = """
    AMEX CIERRE
    SUBTOTAL $3,990.00
    PROPINA $281.75
    TOTAL $4,271.75
    AMEX CIERRE
    SUBTOTAL $12,000.00
    PROPINA $990.25
    TOTAL $12,990.25
    """

    result = vision._extract_payment_ticket_totals(text, "amex")

    assert result is not None
    assert result["values"]["total"] == 17262.0
    assert result["values"]["propina"] == 1272.0


def test_local_ocr_cxc_sums_visible_amounts_and_detects_debit() -> None:
    text = """
    AJUSTE DE CXC DIEGO VILLANUEVA
    tarjeta de debito
    movimiento 87745 $1,695.00
    movimiento 77099 $2,750.00
    movimiento 77098 $2,270.00
    """

    result = vision._extract_cxc_totals(text)

    assert result is not None
    assert result["values"]["monto_total"] == 6715.0
    assert result["values"]["canal"] == "debito"


def test_local_ocr_cxc_prefers_payment_line_with_tip() -> None:
    text = """
    GRAN TOTAL: $2,395.00
    FORMAS DE PAGO
    Tarjeta de debito $2,754.25 $359.25
    """

    result = vision._extract_cxc_totals(text)

    assert result is not None
    assert result["values"]["consumo"] == 2395.0
    assert result["values"]["propina"] == 359.25
    assert result["values"]["monto_total"] == 2754.25
    assert result["values"]["canal"] == "debito"


def test_local_ocr_cxc_payment_breakdown_builds_paypal_formula() -> None:
    text = """
    CXC MESERO MOV 89972 $245
    PAGO CXC MOV 87028 TRANSFERENCIA
    $2565 CUENTA
    $  513 PROPINA
    $3078 TOTAL.
    """

    result = vision._extract_cxc_totals(text)

    assert result is not None
    assert result["values"]["canal"] == "transferencia"
    assert result["values"]["consumo"] == 2565.0
    assert result["values"]["propina"] == 513.0
    assert result["values"]["monto_total"] == 3078.0
    assert result["values"]["paypal_amount"] == 513.0
    assert result["values"]["paypal_formula_terms"] == [3078.0, -2565.0]
    assert result["values"]["cxc_note_amount"] == 245.0
    assert "PAGO CXC MOV 87028 TRANSFERENCIA" in result["values"]["comment_lines"]


def test_local_ocr_cxc_ticket_charge_becomes_paypal_component() -> None:
    text = """
    Gran Total: $245.00
    FORMAS DE PAGO
    Nombre Monto Propina Cambio
    CXC $245.00 $0.00 $0.00
    """

    result = vision._extract_cxc_totals(text)

    assert result is not None
    assert result["values"]["canal"] == "cxc"
    assert result["values"]["cxc_note_amount"] == 245.0
    assert "paypal_amount" not in result["values"]


def test_local_ocr_cxc_transfer_line_infers_account_from_tip() -> None:
    text = """
    Gran Total: $2,565.00
    FORMAS DE PAGO
    Nombre Monto Propina Cambio
    Transferencia $3,078.00 $513.00 $0.00
    """

    result = vision._extract_cxc_totals(text)

    assert result is not None
    assert result["values"]["canal"] == "transferencia"
    assert result["values"]["consumo"] == 2565.0
    assert result["values"]["propina"] == 513.0
    assert result["values"]["paypal_amount"] == 513.0
    assert result["values"]["paypal_formula_terms"] == [3078.0, -2565.0]


def test_local_ocr_cxc_transfer_prefers_gran_total_when_tip_digit_is_misread() -> None:
    text = """
    Gran Total: $2,565.00
    FORMAS DE PAGO
    Nombre Monto Propina Cambio
    Transferencia $3,078.00 $613.00 $0.00
    """

    result = vision._extract_cxc_totals(text)

    assert result is not None
    assert result["values"]["consumo"] == 2565.0
    assert result["values"]["propina"] == 513.0
    assert result["values"]["paypal_amount"] == 513.0
    assert result["values"]["paypal_formula_terms"] == [3078.0, -2565.0]


def test_local_ocr_cxc_transfer_ignores_small_subtotal_noise() -> None:
    text = """
    Subtotal $2,211 21
    Gran Total: $2,565.00
    DOS MIL QUINIENTOS SESENTA Y CINCO PESOS Gran Total: $2,585.00
    Transferencia $3078.00 $613.00 $006
    """

    result = vision._extract_cxc_totals(text)

    assert result is not None
    assert result["values"]["consumo"] == 2565.0
    assert result["values"]["propina"] == 513.0
    assert result["values"]["paypal_amount"] == 513.0


def test_local_ocr_cxc_transfer_corrects_nearby_written_suffix() -> None:
    text = """
    Gran Total: $2,585.00
    DOS MIL QUINIENTOS SESENTA Y CINCO PESOS
    Transferencia $3078.00 $613.00 $006
    """

    result = vision._extract_cxc_totals(text)

    assert result is not None
    assert result["values"]["consumo"] == 2565.0
    assert result["values"]["propina"] == 513.0


def test_local_ocr_cxc_ticket_uses_gran_total_when_payment_line_is_noisy() -> None:
    text = """
    Subtotal: $211.21
    Gran Total: $248.00
    DOSCIENTOS CUARENTA Y CINCO PESOS 00/100 M.N.
    FORMAS DE PAGO
    CXO $245.00 $0.00 $0.00
    """

    result = vision._extract_cxc_totals(text)

    assert result is not None
    assert result["values"]["cxc_note_amount"] == 245.0
    assert "paypal_amount" not in result["values"]


def test_local_ocr_detalle_efectivo_extracts_courtesy() -> None:
    text = """
    DETALLE DE EFECTIVO
    EFECTIVO REAL $3,689.50
    CORTESIA DIRECCION $3,560.00
    TOTAL $7,249.50
    """

    result = vision._extract_detalle_efectivo_totals(text)

    assert result is not None
    assert result["values"]["efectivo_real"] == 3689.5
    assert result["values"]["cortesia_direccion"] == 3560.0
    assert result["values"]["total"] == 7249.5


def test_corte_run_skips_vision_when_disabled(monkeypatch, tmp_path: Path) -> None:
    called = []
    monkeypatch.setattr(script, "_load_sibling_module", lambda name: called.append(name) or None)
    input_payload = {
        "dry_run": True,
        "payload": {
            "business_date": "2026-06-04",
            "restaurant_key": "santo",
            "documents": [
                {
                    "document_key": "tira",
                    "document_type": "tira",
                    "filename": "TIRA X.jpeg",
                    "source_path": str(tmp_path / "tira.jpeg"),
                    "source_hash": "hash",
                }
            ],
            "cierre_terminal": {
                "amex": {"consumo": 10, "propina": 0},
                "bancos": {"consumo": 0, "propina": 0},
                "efectivo": {"consumo": 0, "propina": 0},
                "transferencia": {"consumo": 0, "propina": 0},
                "plataformas": {"consumo": 0, "propina": 0},
            },
            "cierre_sistema": {
                "amex": {"consumo": 10, "propina": 0},
                "bancos": {"consumo": 0, "propina": 0},
                "efectivo": {"consumo": 0, "propina": 0},
                "transferencia": {"consumo": 0, "propina": 0},
                "plataformas": {"consumo": 0, "propina": 0},
            },
        },
    }
    config = {
        "restaurant_map": {"santo": {"display_name": "SANTO"}},
        "drive_folder_map": {"santo": "folder"},
        "mandatory_attachments": [],
        "reviewer_map": {"default": "admin"},
        "payment_forms": ["amex", "bancos", "efectivo", "transferencia", "plataformas"],
        "thresholds": {"reconciliation_tolerance": 0},
        "vision_extraction": {"enabled": False},
    }

    result = script.run(input_payload, config)

    assert result["status"] == "ready_for_approval"
    assert "vision_extractor" not in called
