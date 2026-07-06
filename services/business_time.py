"""Business-date helpers for Santo operations in Mexico City."""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

MEXICO_CITY = ZoneInfo("America/Mexico_City")


def business_now(now: datetime | None = None) -> datetime:
    reference = now or datetime.now(UTC)
    if reference.tzinfo is None:
        raise ValueError("business_now requires a timezone-aware datetime")
    return reference.astimezone(MEXICO_CITY)


def business_today(now: datetime | None = None) -> date:
    return business_now(now).date()
