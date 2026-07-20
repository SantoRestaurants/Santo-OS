from workflows.corte_santo.cxc import parse_cxc_events, receivable_key


def test_parses_june_24_opening_without_movement_id() -> None:
    events = parse_cxc_events("CXC $785 La Valisse, quedando pendiente.")
    assert events == [{
        "kind": "opening",
        "movement_id": None,
        "principal": 785.0,
        "payment_medium": "unclassified",
        "source": "email_body",
        "description": "CXC $785 La Valisse, quedando pendiente",
    }]


def test_parses_june_27_multiple_openings() -> None:
    events = parse_cxc_events(
        "CXC movimiento 90348 $990 y CXC movimiento 90359 $640 La Valisse"
    )
    assert [(event["movement_id"], event["principal"]) for event in events] == [
        ("90348", 990.0),
        ("90359", 640.0),
    ]


def test_parses_june_29_multiple_openings() -> None:
    events = parse_cxc_events(
        "CXC movimiento 90484 $535 error mesero y CXC movimiento 90487 $770 La Valisse"
    )
    assert [(event["movement_id"], event["principal"]) for event in events] == [
        ("90484", 535.0),
        ("90487", 770.0),
    ]


def test_marks_explicit_payment_as_settlement() -> None:
    events = parse_cxc_events("Pago en efectivo de CXC movimiento 89972 $245")
    assert events[0]["kind"] == "settlement"


def test_parses_july_18_multiple_transfer_settlements_from_one_cxc_clause() -> None:
    events = parse_cxc_events(
        "Ajuste de CXC mov. 90359 $640.00 y mov. 90487 $770 pago por transferencia La Valisse"
    )

    assert [(event["kind"], event["movement_id"], event["principal"]) for event in events] == [
        ("settlement", "90359", 640.0),
        ("settlement", "90487", 770.0),
    ]
    assert all(event["payment_medium"] == "transferencia" for event in events)


def test_parses_july_19_multiple_openings_from_one_cxc_clause() -> None:
    events = parse_cxc_events(
        "CXC mov. 91678 $665 y mov. 91691 $340 La Valisse, quedando pendiente"
    )

    assert [(event["kind"], event["movement_id"], event["principal"]) for event in events] == [
        ("opening", "91678", 665.0),
        ("opening", "91691", 340.0),
    ]


def test_receivable_key_is_stable_without_message_id() -> None:
    event = parse_cxc_events("CXC $785 La Valisse, quedando pendiente.")[0]
    first = receivable_key("restaurant", "2026-06-24", event)
    second = receivable_key("restaurant", "2026-06-24", event)
    assert first == second
    assert first.startswith("restaurant:2026-06-24:785.00:")
