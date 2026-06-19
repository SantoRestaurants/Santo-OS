from services.agent_mail.corte_santo_automation import _document_type


def test_cxc_adjustment_photo_is_classified_for_vision() -> None:
    assert _document_type("AJUSTE DE CXC DIEGO VILLANUEVA.jpeg") == "cxc"
    assert _document_type("CXC movimiento pendiente.jpg") == "cxc"


def test_adjustment_photo_without_cxc_stays_generic() -> None:
    assert _document_type("AJUSTE MANUAL.jpeg") == "email_attachment"
