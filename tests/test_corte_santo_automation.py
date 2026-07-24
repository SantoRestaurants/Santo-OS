from pathlib import Path

from services.agent_mail.corte_santo_automation import (
    _document_type,
    _document_type_from_ocr,
    _document_type_from_content,
    _is_probable_inline_signature,
    _vision_document_type,
)


def test_cxc_adjustment_photo_is_classified_for_vision() -> None:
    assert _document_type("AJUSTE DE CXC DIEGO VILLANUEVA.jpeg") == "cxc"
    assert _document_type("CXC movimiento pendiente.jpg") == "cxc"


def test_adjustment_photo_without_cxc_stays_generic() -> None:
    assert _document_type("AJUSTE MANUAL.jpeg") == "email_attachment"


def test_mal_cobro_photo_is_nonvision_adjustment_evidence() -> None:
    assert _document_type("mal cobro 23 jul.jpeg") == "discounts"
    assert _document_type_from_ocr("MAL COBRO MOVIMIENTO 91868") == "discounts"


def test_random_photo_is_classified_from_ocr_labels() -> None:
    assert _document_type(
        "79b6df42-4e6a-4fd8-8544-57fd93beaf5c.jpg",
        ocr_text="CIERRE AMERICAN EXPRESS TOTAL 12,345.00",
    ) == "amex"
    assert _document_type(
        "3e030814-ee2e-441d-bf2a-9a079e7c27e1.jpg",
        ocr_text="BANORTE CIERRE DE LOTE VISA TOTAL",
    ) == "bancarias"
    assert _document_type(
        "dde1bf35-34a1-46cc-ac78-c2da272485bb.jpg",
        ocr_text="VENTAS POR FORMA DE PAGO TOTAL VENTAS TOTAL PROPINAS REPORTE DE VENTAS",
    ) == "tira"


def test_weak_or_ambiguous_ocr_signal_stays_generic() -> None:
    assert _document_type_from_ocr("TOTAL 123.45") == "email_attachment"
    assert _document_type_from_ocr("AMEX BANORTE TOTAL") == "email_attachment"


def test_wansoft_workbook_is_classified() -> None:
    assert _document_type("CONTROL MOVIMIENTOS 14 JULIO 2026 WANSOFT.xlsx") == "wansoft_system_close"


def test_generic_workbook_is_classified_from_corte_labels(tmp_path: Path) -> None:
    fixture = Path("workflows/corte_santo/fixtures/santo_corte_sample.xlsx")
    extensionless = tmp_path / "attachment"
    extensionless.write_bytes(fixture.read_bytes())

    assert _document_type_from_content(
        extensionless,
        "attachment",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ) == "corte_excel"


def test_tira_ocr_wins_over_payment_brand_on_system_close_photo() -> None:
    assert _document_type_from_ocr(
        "TOTALES GENERALES VENTAS POR FORMA DE PAGO "
        "AMERICAN EXPRESS CONTROL POR FORMA INFORMACION OPERATIVA"
    ) == "tira"


def test_common_forwarded_signature_image_is_ignored() -> None:
    assert _is_probable_inline_signature("image.png", "image/png") is True
    assert _is_probable_inline_signature("random-photo.jpg", "image/jpeg") is False


def test_opaque_image_classification_does_not_call_vision_when_ocr_only(monkeypatch, tmp_path: Path) -> None:
    image = tmp_path / "opaque.jpeg"
    image.write_bytes(b"fake-image")
    monkeypatch.setenv("TEST_GEMINI_KEY", "key")

    def fail_if_called(*args, **kwargs):
        raise AssertionError("vision fallback must be disabled in OCR-only mode")

    monkeypatch.setattr("workflows.corte_santo.vision_extractor._call_gemini", fail_if_called)
    result = _vision_document_type(
        image,
        {
            "vision_extraction": {
                "provider": "gemini",
                "model": "gemini-test",
                "api_key_env": "TEST_GEMINI_KEY",
                "local_ocr_fallback_to_vision": False,
            }
        },
    )

    assert result == "email_attachment"
