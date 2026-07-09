"""
Corte Santo bank statement parsing (Banorte CSV + AMEX .xls/.xlsx).

Implements the operator's documented rules for identifying what actually landed
in the account, used to compute "cobros pendientes" and to cross-check deposits:

- A Banorte deposit row whose description contains "REST SANTO" is a Banorte
  terminal settlement. Otherwise, the description must be inspected to classify
  the source (AMEX / Uber SPEI / transfer).
- Incoming SPEI from "AMERICAN EXPRESS" => AMEX collection.
- Incoming SPEI mentioning "UBR PAGOS" / "UBER" => Uber collection.
- Incoming SPEI mentioning "RAPPI" => Rappi collection.
- Additional expenses are withdrawals that are not bank commissions or IVA.
- CXC = cuenta por cobrar (accounts receivable).

Everything is keyword-driven via config (`bank_keywords`) with a shipped default
so nothing is hardcoded as a business rule that can't be reconfigured.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import Any


DEFAULT_BANK_KEYWORDS: dict[str, list[str]] = {
    "banorte_settlement": ["REST SANTO"],
    "amex_spei": ["AMERICAN EXPRESS"],
    "uber_spei": ["UBR PAGOS", "UBER"],
    "rappi_spei": ["RAPPI", "TRAPP"],
    "domiciliacion": ["DOMICILIACION", "SPOTIFY", "DOMICILIADO"],
    "ignore_deposit": ["ABONO DCTO. CARTERA"],
    "ignore_fee": ["COMISION", "IVA COMISION", "IVA"],
}

# Canonical Banorte CSV column names plus legacy mojibake variants observed in
# earlier parser runs.
COL_DESC = "DESCRIPCION"
COL_DESC_DETAIL = "DESCRIPCION_DETALLADA"
COL_DEPOSIT = "DEPOSITOS"
COL_WITHDRAWAL = "RETIROS"
COL_SALDO = "SALDO"
COL_OPERATION_DATE = "FECHA_DE_OPERACION"

COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    COL_DESC: ("DESCRIPCIÓN", "DESCRIPCIÃ“N", "DESCRIPCION"),
    COL_DESC_DETAIL: ("DESCRIPCIÓN DETALLADA", "DESCRIPCIÃ“N DETALLADA", "DESCRIPCION DETALLADA"),
    COL_DEPOSIT: ("DEPÓSITOS", "DEPÃ“SITOS", "DEPOSITOS"),
    COL_WITHDRAWAL: ("RETIROS",),
    COL_SALDO: ("SALDO",),
    COL_OPERATION_DATE: ("FECHA DE OPERACIÓN", "FECHA DE OPERACIÃ“N", "FECHA DE OPERACIÃƒâ€œN", "FECHA DE OPERACION"),
}


def _to_amount(value: Any) -> float:
    if value in (None, "", "-"):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("$", "").replace(",", "").replace(" ", "")
    if text in ("", "-"):
        return 0.0
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    try:
        amount = float(text)
    except ValueError:
        return 0.0
    return -amount if negative else amount


def _row_value(row: dict[str, Any], canonical: str) -> Any:
    for key in COLUMN_ALIASES.get(canonical, (canonical,)):
        if key in row:
            return row.get(key)
    return None


def _classify(description: str, detail: str, keywords: dict[str, list[str]]) -> str:
    blob = f"{description} {detail}".upper()
    # Order matters: settlement first, then specific SPEI sources.
    if any(k.upper() in blob for k in keywords.get("banorte_settlement", [])):
        return "banorte"
    if any(k.upper() in blob for k in keywords.get("amex_spei", [])):
        return "amex"
    if any(k.upper() in blob for k in keywords.get("uber_spei", [])):
        return "uber"
    if any(k.upper() in blob for k in keywords.get("rappi_spei", [])):
        return "rappi"
    if any(k.upper() in blob for k in keywords.get("domiciliacion", [])):
        return "domiciliacion"
    if any(k.upper() in blob for k in keywords.get("ignore_deposit", [])):
        return "ignored_deposit"
    return "unclassified"


def parse_banorte_rows(rows: list[dict[str, Any]], config: dict[str, Any] | None = None) -> dict[str, Any]:
    """Classify Banorte statement rows into deposits by source and expenses."""
    config = config or {}
    keywords = {**DEFAULT_BANK_KEYWORDS, **(config.get("bank_keywords") or {})}

    deposits_by_source: dict[str, float] = {}
    deposits: list[dict[str, Any]] = []
    additional_expenses: list[dict[str, Any]] = []
    unclassified_deposits: list[dict[str, Any]] = []
    ignored_deposits: list[dict[str, Any]] = []

    for row in rows:
        desc = str(_row_value(row, COL_DESC) or "")
        detail = str(_row_value(row, COL_DESC_DETAIL) or "")
        operation_date = _row_value(row, COL_OPERATION_DATE)
        deposit = _to_amount(_row_value(row, COL_DEPOSIT))
        withdrawal = _to_amount(_row_value(row, COL_WITHDRAWAL))
        kind = _classify(desc, detail, keywords)

        if deposit > 0:
            if kind == "unclassified":
                unclassified_deposits.append({
                    "description": desc.strip(),
                    "detail": detail.strip(),
                    "amount": round(deposit, 2),
                    "operation_date": operation_date,
                })
            elif kind == "ignored_deposit":
                ignored_deposits.append({
                    "description": desc.strip(),
                    "detail": detail.strip(),
                    "amount": round(deposit, 2),
                    "operation_date": operation_date,
                })
            else:
                deposits_by_source[kind] = round(deposits_by_source.get(kind, 0.0) + deposit, 2)
                deposits.append(
                    {
                        "source": kind,
                        "amount": round(deposit, 2),
                        "description": desc.strip(),
                        "detail": detail.strip(),
                        "operation_date": operation_date,
                    }
                )
        elif withdrawal > 0:
            blob = f"{desc} {detail}".upper()
            if not any(k.upper() in blob for k in keywords.get("ignore_fee", [])):
                additional_expenses.append({
                    "description": desc.strip(),
                    "detail": detail.strip(),
                    "amount": round(withdrawal, 2),
                    "operation_date": operation_date,
                    "category": "gasto_adicional",
                })

    return {
        "deposits_by_source": deposits_by_source,
        "deposits": deposits,
        # Keep the old key as an alias because downstream code already reads it.
        "domiciled_expenses": additional_expenses,
        "additional_expenses": additional_expenses,
        "unclassified_deposits": unclassified_deposits,
        "ignored_deposits": ignored_deposits,
        "final_balance": _to_amount(_row_value(rows[-1], COL_SALDO)) if rows else None,
        # Any unclassified deposit is money we couldn't attribute -> review.
        "status": "requires_review" if unclassified_deposits else "ok",
    }


def parse_banorte_csv(source_path: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    path = Path(source_path)
    if not path.is_file():
        return {
            "status": "requires_review",
            "review_reason": f"file_not_found:{source_path}",
            "deposits_by_source": {},
            "deposits": [],
            "domiciled_expenses": [],
            "additional_expenses": [],
            "unclassified_deposits": [],
            "ignored_deposits": [],
        }
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = [dict(r) for r in reader]
    result = parse_banorte_rows(rows, config)
    result["row_count"] = len(rows)
    return result
