from datetime import datetime, timezone

from services.business_time import business_now, business_today


def test_business_date_uses_mexico_city_before_utc_day_rollover() -> None:
    utc_now = datetime(2026, 7, 5, 2, 30, tzinfo=timezone.utc)

    assert business_now(utc_now).isoformat() == "2026-07-04T20:30:00-06:00"
    assert business_today(utc_now).isoformat() == "2026-07-04"
