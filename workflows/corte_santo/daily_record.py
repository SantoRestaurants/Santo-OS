"""Canonical Corte daily-record helpers.

This module contains no database client. It converts parsed spreadsheet facts
into the stable row written by live automation and historical importers.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


PARSER_VERSION = "corte_daily_record_v1"
PAYMENT_CHANNELS = (
    "amex", "debito", "credito", "efectivo", "transferencia", "paypal",
    "uber", "uber_eats", "ubereats", "rappi",
)


def amount(value: Any) -> float:
    if value in (None, "", "-"):
        return 0.0
    try:
        return round(float(Decimal(str(value).replace("$", "").replace(",", ""))), 2)
    except (InvalidOperation, TypeError, ValueError):
        return 0.0


def spreadsheet_totals(income_register: dict[str, Any]) -> dict[str, float]:
    """Reproduce the Ingresos workbook's Total Bruto and Venta Bruta rules."""
    values = income_register if isinstance(income_register, dict) else {}
    seen_uber = False
    total_bruto = 0.0
    for channel in PAYMENT_CHANNELS:
        if channel in {"uber_eats", "ubereats"} and seen_uber:
            continue
        value = amount(values.get(channel))
        if channel in {"uber", "uber_eats", "ubereats"}:
            if value == 0 and channel != "ubereats":
                continue
            if seen_uber:
                continue
            seen_uber = True
        total_bruto += value
    total_bruto = round(total_bruto, 2)
    propinas = amount(values.get("propinas"))
    return {
        "total_bruto": total_bruto,
        "venta_bruta": round(total_bruto - propinas, 2),
    }
def build_daily_record(
    *,
    restaurant_id: str,
    business_date: str,
    income_register: dict[str, Any],
    venta_bruta: Any,
    total: Any = None,
    total_bruto: Any = None,
    forecast_target: Any = None,
    source_kind: str,
    source_workflow_run_id: str | None = None,
    source_filename: str | None = None,
    source_sheet: str | None = None,
    source_row: int | None = None,
    source_hash: str | None = None,
    parser_version: str = PARSER_VERSION,
) -> dict[str, Any]:
    """Build the explicit Supabase row without conflating financial totals."""
    channels = income_register if isinstance(income_register, dict) else {}
    known = {
        "amex", "debito", "credito", "efectivo", "transferencia", "total",
        "paypal", "uber", "uber_eats", "ubereats", "rappi", "propinas",
        "venta_bruta", "total_bruto",
    }
    extra_values = {key: value for key, value in channels.items() if key not in known}
    calculated = spreadsheet_totals(channels)
    resolved_venta_bruta = calculated["venta_bruta"] if venta_bruta is None else amount(venta_bruta)
    resolved_total_bruto = calculated["total_bruto"] if total_bruto is None else amount(total_bruto)
    return {
        "restaurant_id": restaurant_id,
        "business_date": business_date,
        "amex": amount(channels.get("amex")),
        "debito": amount(channels.get("debito")),
        "credito": amount(channels.get("credito")),
        "efectivo": amount(channels.get("efectivo")),
        "transferencia": amount(channels.get("transferencia")),
        "total": amount(total if total is not None else channels.get("total")),
        "paypal": amount(channels.get("paypal")),
        "uber_eats": amount(channels.get("uber_eats", channels.get("ubereats", channels.get("uber")))),
        "rappi": amount(channels.get("rappi")),
        "propinas": amount(channels.get("propinas")),
        "venta_bruta": resolved_venta_bruta,
        "total_bruto": resolved_total_bruto,
        "forecast_target": None if forecast_target is None else amount(forecast_target),
        "extra_values": extra_values,
        "source_kind": source_kind,
        "source_workflow_run_id": source_workflow_run_id,
        "source_filename": source_filename,
        "source_sheet": source_sheet,
        "source_row": source_row,
        "source_hash": source_hash,
        "parser_version": parser_version,
    }
