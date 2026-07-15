from services.agent_mail.corte_santo_automation import _document_type, _document_type_from_ocr


def test_cxc_adjustment_photo_is_classified_for_vision() -> None:
    assert _document_type("AJUSTE DE CXC DIEGO VILLANUEVA.jpeg") == "cxc"
    assert _document_type("CXC movimiento pendiente.jpg") == "cxc"


def test_adjustment_photo_without_cxc_stays_generic() -> None:
    assert _document_type("AJUSTE MANUAL.jpeg") == "email_attachment"


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
