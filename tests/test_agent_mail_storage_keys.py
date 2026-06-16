from services.agent_mail.poller import _safe_message_storage_id, _safe_storage_segment


def test_message_storage_id_hashes_rfc_message_id() -> None:
    value = _safe_message_storage_id("<CAMUAxjBJox10uX8L7@example.com>")

    assert value.startswith("msg_")
    assert "<" not in value
    assert "@" not in value
    assert "/" not in value


def test_safe_storage_segment_removes_invalid_characters() -> None:
    value = _safe_storage_segment("SANTO CORTE 04 JUNIO 2026 <copy>.xlsx")

    assert value == "SANTO_CORTE_04_JUNIO_2026_copy_.xlsx"
    assert "<" not in value
    assert " " not in value
