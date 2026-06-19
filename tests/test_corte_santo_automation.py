from services.agent_mail.corte_santo_automation import _document_type


def test_cxc_adjustment_photo_is_classified_for_vision() -> None:
    assert _document_type("AJUSTE DE CXC DIEGO VILLANUEVA.jpeg") == "cxc"
    assert _document_type("CXC movimiento pendiente.jpg") == "cxc"
