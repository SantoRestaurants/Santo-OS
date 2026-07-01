"""
Corte Santo bank statement parsing (Banorte CSV + AMEX .xls/.xlsx).

Implements the operator's documented rules for identifying what actually landed
in the account, used to compute "cobros pendientes" and to cross-check deposits:

- A Banorte deposit row whose description contains "REST SANTO" is a Banorte
  terminal settlement. Otherwise, the description must be inspected to classify
  the source (AMEX / Uber SPEI / transfer).
- Incoming SPEI from "AMERICAN EXPRESS" => AMEX collection.
- Incoming SPEI mentioning "UBR PAGOS" / "UBER" => Uber collection.
- Additional expenses ("gastos adicionales") are domiciled charges: Spotify,
  credit-card payment, internet — they say "domiciliacion" in the description.
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
    "rappi_spei": ["RAPPI"],
    "domiciliacion": ["DOMICILIACION", "SPOTIFY", "DOMICILIADO"],
    "ignore_deposit": ["ABONO DCTO. CARTERA"],
    "ignore_fee": ["COMISION", "IVA COMISION"],
}

# Banorte CSV column names (Spanish, as exported).
COL_DESC = "DESCRIPCIÓN"
COL_DESC_DETAIL = "DESCRIPCIÓN DETALLADA"
COL_DEPOSIT = "DEPÓSITOS"
COL_WITHDRAWAL = "RETIROS"
COL_SALDO = "SALDO"


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
    """Classify Banorte statement rows into deposits-by-source and domiciled expenses."""
    config = config or {}
    keywords = {**DEFAULT_BANK_KEYWORDS, **(config.get("bank_keywords") or {})}

    deposits_by_source: dict[str, float] = {}
    deposits: list[dict[str, Any]] = []
    domiciled_expenses: list[dict[str, Any]] = []
    unclassified_deposits: list[dict[str, Any]] = []
    ignored_deposits: list[dict[str, Any]] = []

    for row in rows:
        desc = str(row.get(COL_DESC, "") or "")
        detail = str(row.get(COL_DESC_DETAIL, "") or "")
        deposit = _to_amount(row.get(COL_DEPOSIT))
        withdrawal = _to_amount(row.get(COL_WITHDRAWAL))
        kind = _classify(desc, detail, keywords)

        if deposit > 0:
            if kind == "unclassified":
                unclassified_deposits.append({"description": desc.strip(), "amount": round(deposit, 2)})
            elif kind == "ignored_deposit":
                ignored_deposits.append({"description": desc.strip(), "amount": round(deposit, 2)})
            else:
                deposits_by_source[kind] = round(deposits_by_source.get(kind, 0.0) + deposit, 2)
                deposits.append(
                    {
                        "source": kind,
                        "amount": round(deposit, 2),
                        "description": desc.strip(),
                        "detail": detail.strip(),
                        "operation_date": row.get("FECHA DE OPERACIÃ“N") or row.get("FECHA DE OPERACIÓN"),
                    }
                )
        elif withdrawal > 0 and kind == "domiciliacion":
            domiciled_expenses.append({"description": desc.strip(), "amount": round(withdrawal, 2)})

    return {
        "deposits_by_source": deposits_by_source,
        "deposits": deposits,
        "domiciled_expenses": domiciled_expenses,
        "unclassified_deposits": unclassified_deposits,
        "ignored_deposits": ignored_deposits,
        "final_balance": _to_amount(rows[-1].get(COL_SALDO)) if rows else None,
        # Any unclassified deposit is money we couldn't attribute -> review.
        "status": "requires_review" if unclassified_deposits else "ok",
    }


def parse_banorte_csv(source_path: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    path = Path(source_path)
    if not path.is_file():
        return {"status": "requires_review", "review_reason": f"file_not_found:{source_path}",
                "deposits_by_source": {}, "deposits": [], "domiciled_expenses": [], "unclassified_deposits": [], "ignored_deposits": []}
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows = [dict(r) for r in reader]
    result = parse_banorte_rows(rows, config)
    result["row_count"] = len(rows)
    return result
