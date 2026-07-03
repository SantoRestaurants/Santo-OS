from workflows.corte_santo.daily_record import build_daily_record, spreadsheet_totals


def test_daily_record_keeps_venta_bruta_and_total_bruto_separate() -> None:
    row = build_daily_record(
        restaurant_id="restaurant-id",
        business_date="2026-06-30",
        income_register={"amex": 100, "uber": 25, "total_bruto": 999},
        venta_bruta=875,
        total_bruto=999,
        source_kind="historical_import",
    )

    assert row["venta_bruta"] == 875.0
    assert row["total_bruto"] == 999.0
    assert row["uber_eats"] == 25.0


def test_daily_record_preserves_unmapped_spreadsheet_values() -> None:
    row = build_daily_record(
        restaurant_id="restaurant-id",
        business_date="2026-06-30",
        income_register={"amex": 100, "cortesia": 12.5},
        venta_bruta=875,
        source_kind="automatic_corte",
    )

    assert row["extra_values"] == {"cortesia": 12.5}


def test_spreadsheet_totals_match_historical_ingresos_formula() -> None:
    totals = spreadsheet_totals({
        "amex": 27137.36,
        "debito": 12667.37,
        "credito": 90225.34,
        "efectivo": 12326,
        "paypal": 230,
        "uber": 4885,
        "rappi": 0,
        "propinas": 14366.57,
    })

    assert totals["total_bruto"] == 147471.07
    assert totals["venta_bruta"] == 133104.50
