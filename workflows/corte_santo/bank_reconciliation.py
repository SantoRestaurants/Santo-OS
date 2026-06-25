"""Second-stage bank validation for Corte Santo."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import xlrd
except Exception:  # pragma: no cover
    xlrd = None  # type: ignore[assignment]


def _amount(value: Any) -> float:
    if value in (None, "", "-"):
        return 0.0
    text = str(value).replace("$", "").replace(",", "").replace("(", "-").replace(")", "").strip()
    try:
        return round(float(text), 2)
    except ValueError:
        return 0.0


def _date_key(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return text


def parse_amex_rows(rows: list[list[Any]]) -> dict[str, Any]:
    """Parse AMEX export rows using its named columns."""
    header_index = None
    headers: list[str] = []
    for index, row in enumerate(rows):
        normalized = [str(value or "").strip().lower() for value in row]
        if "monto del pago" in normalized and "fecha de pago" in normalized:
            header_index = index
            headers = normalized
            break
    if header_index is None:
        return {"status": "requires_review", "review_reason": "amex_headers_not_found", "payments": []}

    amount_col = headers.index("monto del pago")
    date_col = headers.index("fecha de pago")
    payments = []
    shipment_col = headers.index("fecha de envío") if "fecha de envío" in headers else None

    gross_col = None
    if "importe bruto" in headers:
        gross_col = headers.index("importe bruto")
    elif "monto bruto" in headers:
        gross_col = headers.index("monto bruto")

    for row in rows[header_index + 1 :]:
        amount = _amount(row[amount_col] if amount_col < len(row) else None)
        if amount <= 0:
            continue

        gross_amount = amount
        if gross_col is not None:
            gross_val = _amount(row[gross_col] if gross_col < len(row) else None)
            if gross_val > 0:
                gross_amount = gross_val

        payments.append(
            {
                "payment_date": row[date_col] if date_col < len(row) else None,
                "source_date": row[shipment_col] if shipment_col is not None and shipment_col < len(row) else None,
                "amount": amount,
                "gross_amount": gross_amount,
            }
        )
    return {"status": "ok", "payments": payments, "total_expected": round(sum(p["amount"] for p in payments), 2)}


def parse_amex_xls(source_path: str) -> dict[str, Any]:
    path = Path(source_path)
    if not path.is_file():
        return {"status": "requires_review", "review_reason": "amex_file_not_found", "payments": []}
    if xlrd is None:
        return {"status": "requires_review", "review_reason": "xlrd_not_available", "payments": []}
    book = xlrd.open_workbook(str(path))
    sheet = book.sheet_by_index(0)
    rows = [sheet.row_values(index) for index in range(sheet.nrows)]
    return parse_amex_rows(rows)


def reconcile_bank_stage(
    expected_collections: list[dict[str, Any]],
    banorte_statement: dict[str, Any],
    amex_statement: dict[str, Any],
    *,
    tolerance: float = 0.0,
) -> dict[str, Any]:
    """Match expected collections to bank deposits; unmatched expectations remain pending."""
    exceptions = []
    if banorte_statement.get("status") != "ok":
        exceptions.append({"exception_key": "banorte_statement_requires_review", "details": banorte_statement})
    if amex_statement.get("status") != "ok":
        exceptions.append({"exception_key": "amex_statement_requires_review", "details": amex_statement})

    if not isinstance(expected_collections, list):
        expected_collections = []
    expected = [dict(item) for item in expected_collections if isinstance(item, dict)]
    corte_amex = [item for item in expected if item.get("channel") == "amex"]
    corte_others = [item for item in expected if item.get("channel") != "amex"]
    
    amex_matches = []
    pending_corte_amex = []
    
    amex_payments = [dict(item, _matched_corte=False) for item in amex_statement.get("payments", [])]
    
    for item in corte_amex:
        item_amount = round(float(item.get("expected_deposit", item.get("amount", 0))), 2)
        source_date = _date_key(item.get("source_date"))
        
        matched_payment = next(
            (
                p for p in amex_payments 
                if not p["_matched_corte"] 
                and _date_key(p.get("source_date")) == source_date
                and abs(float(p.get("gross_amount", p.get("amount", 0))) - item_amount) <= tolerance
            ), 
            None
        )
        if not matched_payment:
            matched_payment = next(
                (
                    p for p in amex_payments 
                    if not p["_matched_corte"] 
                    and abs(float(p.get("gross_amount", p.get("amount", 0))) - item_amount) <= tolerance
                ), 
                None
            )
            
        if matched_payment:
            matched_payment["_matched_corte"] = True
            amex_matches.append({"corte_expected": item, "amex_payment": {k: v for k, v in matched_payment.items() if k != "_matched_corte"}})
        else:
            pending_corte_amex.append(item)
            
    banorte_expected = []
    for p in amex_payments:
        banorte_expected.append({
            "channel": "amex",
            "amount": p["amount"],
            "expected_payment_date": p.get("payment_date"),
            "source_date": p.get("source_date"),
            "_original_amex": {k: v for k, v in p.items() if k != "_matched_corte"},
        })
        
    for item in corte_others:
        banorte_expected.append({
            "channel": item.get("channel"),
            "amount": item.get("expected_deposit", item.get("amount", 0)),
            "expected_payment_date": item.get("expected_payment_date"),
            "source_date": item.get("source_date"),
            "_original_corte": item,
        })
        
    if not banorte_expected and not pending_corte_amex:
        exceptions.append({"exception_key": "expected_collections_missing", "details": {}})

    available = [dict(item, matched=False) for item in banorte_statement.get("deposits", [])]
    matches = []
    pending_items = []
    expected_remaining = [dict(item, _matched=False) for item in banorte_expected]

    # AMEX often lands in Banorte as one consolidated SPEI for several AMEX
    # payment rows with the same expected payment date. Match the dated group
    # before falling back to one-to-one exact matching.
    for deposit in available:
        if deposit["matched"]:
            continue
        channel = deposit.get("source")
        operation_date = _date_key(deposit.get("operation_date"))
        if not channel or not operation_date:
            continue
        candidates = [
            item
            for item in expected_remaining
            if not item["_matched"]
            and item.get("channel") == channel
            and _date_key(item.get("expected_payment_date")) == operation_date
        ]
        if len(candidates) < 2:
            continue
        total = round(sum(float(item.get("expected_deposit", item.get("amount", 0))) for item in candidates), 2)
        if abs(float(deposit.get("amount", 0)) - total) <= tolerance:
            deposit["matched"] = True
            for item in candidates:
                item["_matched"] = True
            matches.append({"expected_group": [{k: v for k, v in item.items() if k != "_matched"} for item in candidates], "deposit": deposit})

    for item in expected_remaining:
        if item["_matched"]:
            continue
        channel = item.get("channel")
        amount = round(float(item.get("expected_deposit", item.get("amount", 0))), 2)
        matched = next(
            (
                deposit
                for deposit in available
                if not deposit["matched"]
                and deposit.get("source") == channel
                and abs(float(deposit.get("amount", 0)) - amount) <= tolerance
            ),
            None,
        )
        if matched:
            matched["matched"] = True
            item["_matched"] = True
            matches.append({"expected": {k: v for k, v in item.items() if k != "_matched"}, "deposit": matched})
        else:
            pending_items.append({k: v for k, v in item.items() if not k.startswith("_")})

    unmatched_deposits = [item for item in available if not item["matched"]]
    pending: dict[str, float] = {}
    for item in pending_corte_amex:
        channel = str(item.get("channel", "unclassified"))
        pending[channel] = round(
            pending.get(channel, 0.0) + float(item.get("expected_deposit", item.get("amount", 0))),
            2,
        )
    for item in pending_items:
        channel = str(item.get("channel", "unclassified"))
        pending[channel] = round(
            pending.get(channel, 0.0) + float(item.get("expected_deposit", item.get("amount", 0))),
            2,
        )

    return {
        "status": "requires_review" if exceptions else "bank_validated",
        "matches": matches,
        "amex_matches": amex_matches,
        "pending_items": pending_corte_amex + pending_items,
        "missing_funds": {
            "corte_to_amex": round(sum(float(item.get("expected_deposit", item.get("amount", 0))) for item in pending_corte_amex), 2),
            "amex_to_banorte": round(sum(float(item.get("amount", 0)) for item in pending_items if item.get("channel") == "amex"), 2),
            "others_to_banorte": round(sum(float(item.get("expected_deposit", item.get("amount", 0))) for item in pending_items if item.get("channel") != "amex"), 2),
        },
        "unmatched_deposits": unmatched_deposits,
        "pending_collections": pending,
        "additional_expenses": banorte_statement.get("domiciled_expenses", []),
        "exceptions": exceptions,
    }
