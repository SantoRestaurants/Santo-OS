"""Second-stage bank validation for Corte Santo."""

from __future__ import annotations

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
    for row in rows[header_index + 1 :]:
        amount = _amount(row[amount_col] if amount_col < len(row) else None)
        if amount <= 0:
            continue
        payments.append(
            {
                "payment_date": row[date_col] if date_col < len(row) else None,
                "source_date": row[shipment_col] if shipment_col is not None and shipment_col < len(row) else None,
                "amount": amount,
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
    # AMEX's own export is the authoritative list of expected AMEX payments.
    expected = [dict(item) for item in expected_collections if isinstance(item, dict)]
    existing_amex = [item for item in expected if item.get("channel") == "amex"]
    if not existing_amex:
        expected.extend(
            {
                "channel": "amex",
                "amount": item["amount"],
                "source_date": item.get("source_date"),
                "expected_payment_date": item.get("payment_date"),
            }
            for item in amex_statement.get("payments", [])
        )
    if not expected:
        exceptions.append({"exception_key": "expected_collections_missing", "details": {}})

    available = [dict(item, matched=False) for item in banorte_statement.get("deposits", [])]
    matches = []
    pending_items = []
    for item in expected:
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
            matches.append({"expected": item, "deposit": matched})
        else:
            pending_items.append(item)

    unmatched_deposits = [item for item in available if not item["matched"]]
    pending: dict[str, float] = {}
    for item in pending_items:
        channel = str(item.get("channel", "unclassified"))
        pending[channel] = round(
            pending.get(channel, 0.0)
            + float(item.get("expected_deposit", item.get("amount", 0))),
            2,
        )

    return {
        "status": "requires_review" if exceptions else "bank_validated",
        "matches": matches,
        "pending_items": pending_items,
        "unmatched_deposits": unmatched_deposits,
        "pending_collections": pending,
        "additional_expenses": banorte_statement.get("domiciled_expenses", []),
        "exceptions": exceptions,
    }
