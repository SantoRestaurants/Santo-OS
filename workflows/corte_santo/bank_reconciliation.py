"""Second-stage bank validation for Corte Santo.

AMEX XLS columns:
  - Cargos totales    = importe bruto (matches Corte AMEX del dia)
  - Monto del pago    = importe neto (matches Banorte SPEI AMEX)
  - Numero de Pago    = batch ID (groups payments into one Banorte deposit)
  - Fecha de envio    = shipment date (>= Corte date for validity, not exact)
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import xlrd
except Exception:  # pragma: no cover
    xlrd = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


def _amount(value: Any) -> float:
    if value in (None, "", "-"):
        return 0.0
    if isinstance(value, (int, float)):
        return round(float(value), 2)
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


def _date_ge(a: str | None, b: str | None) -> bool:
    """True if date a >= date b (a is same day or after b)."""
    if not a or not b:
        return True  # if we can't parse dates, allow the match
    return a >= b


def parse_amex_rows(rows: list[list[Any]], book_datemode: int = 0) -> dict[str, Any]:
    """Parse AMEX export using actual column names from the bank export.

    Expected columns (from "Envios" sheet):
      - Fecha de envio (col 0)
      - Numero de Pago (col 2)
      - Cargos totales (col 3) = BRUTO -> matches Corte AMEX
      - Monto del descuento (col 7)
      - Monto del pago (col 9) = NETO -> matches Banorte SPEI
    """
    header_index = None
    headers: list[str] = []
    for index, row in enumerate(rows):
        normalized = [str(value or "").strip().lower() for value in row]
        if "cargos totales" in normalized and "monto del pago" in normalized:
            header_index = index
            headers = normalized
            break
    if header_index is None:
        # Fallback: try old format
        for index, row in enumerate(rows):
            normalized = [str(value or "").strip().lower() for value in row]
            if "monto del pago" in normalized and "fecha de pago" in normalized:
                header_index = index
                headers = normalized
                break
    if header_index is None:
        return {"status": "requires_review", "review_reason": "amex_headers_not_found", "payments": []}

    # Map columns by name
    col_map: dict[str, int] = {}
    for i, h in enumerate(headers):
        col_map[h] = i

    def _col(name: str) -> int | None:
        return col_map.get(name)

    cargos_col = _col("cargos totales")
    neto_col = _col("monto del pago")
    pago_col = _col("numero de pago") or _col("número de pago")
    envio_col = _col("fecha de envio") or _col("fecha de envío")
    desc_col = _col("monto del descuento")

    # Fallback for old format
    if cargos_col is None:
        cargos_col = _col("importe bruto") or _col("monto bruto")
    date_col = _col("fecha de pago")
    # If still no bruto column, use neto column for both
    if cargos_col is None and neto_col is not None:
        cargos_col = neto_col

    payments = []
    for row in rows[header_index + 1:]:
        if cargos_col is not None and cargos_col < len(row):
            cargos = _amount(row[cargos_col])
        else:
            cargos = 0.0

        if cargos <= 0:
            continue

        neto = _amount(row[neto_col]) if neto_col is not None and neto_col < len(row) else cargos
        if neto <= 0:
            neto = cargos

        pago_num = str(row[pago_col]).strip() if pago_col is not None and pago_col < len(row) else ""
        envio_raw = row[envio_col] if envio_col is not None and envio_col < len(row) else None
        desc = _amount(row[desc_col]) if desc_col is not None and desc_col < len(row) else 0.0

        # Convert Excel date floats
        if isinstance(envio_raw, float) and book_datemode:
            try:
                envio_raw = xlrd.xldate_as_datetime(envio_raw, book_datemode).strftime("%Y-%m-%d")
            except Exception:
                envio_raw = str(envio_raw)
        envio_date = _date_key(envio_raw)

        date_raw = row[date_col] if date_col is not None and date_col < len(row) else None
        if isinstance(date_raw, float) and book_datemode:
            try:
                date_raw = xlrd.xldate_as_datetime(date_raw, book_datemode).strftime("%Y-%m-%d")
            except Exception:
                date_raw = str(date_raw)

        payments.append({
            "fecha_envio": envio_date,
            "pago_num": pago_num,
            "cargos": cargos,       # bruto
            "neto": neto,            # after commission
            "descuento": desc,
            "payment_date": _date_key(date_raw),
            "gross_amount": cargos,
            "amount": neto,
            "source_date": envio_date,
        })

    total_neto = round(sum(p["neto"] for p in payments), 2)
    return {"status": "ok", "payments": payments, "total_expected": total_neto}


def parse_amex_xls(source_path: str) -> dict[str, Any]:
    path = Path(source_path)
    if not path.is_file():
        return {"status": "requires_review", "review_reason": "amex_file_not_found", "payments": []}
    if xlrd is None:
        return {"status": "requires_review", "review_reason": "xlrd_not_available", "payments": []}
    book = xlrd.open_workbook(str(path))
    sheet = book.sheet_by_index(0)
    rows = [sheet.row_values(index) for index in range(sheet.nrows)]
    return parse_amex_rows(rows, book.datemode)


def _match_amex_to_corte(
    amex_payments: list[dict[str, Any]],
    corte_expected: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Match AMEX cargos (bruto) to Corte expected AMEX collections.

    Two rounds:
      1. Exact individual match: cargos == corte_day.amex
      2. Pair match within same batch+fecha: sum of 2 unmatched cargos == corte_day.amex

    Returns: (matched_days, pending_corte, remaining_amex_payments)
    """
    remaining_corte = [dict(item) for item in corte_expected if isinstance(item, dict)]
    remaining_amex = [dict(p, _used=False) for p in amex_payments]

    logger.info(
        "_match_amex_to_corte: %d corte expected, %d amex payments",
        len(remaining_corte), len(remaining_amex),
    )
    for idx, item in enumerate(remaining_corte[:5]):
        logger.info("  corte[%d]: amount=%.2f date=%s", idx, item.get("amount", 0), item.get("business_date") or item.get("source_date"))
    for idx, p in enumerate(remaining_amex[:5]):
        logger.info("  amex[%d]: cargos=%.2f envio=%s pago=%s", idx, p.get("cargos", 0), p.get("fecha_envio"), p.get("pago_num", ""))

    # Group by batch
    by_batch: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in remaining_amex:
        by_batch[p.get("pago_num", "")].append(p)

    matched_days: list[dict[str, Any]] = []

    # Round 1: exact individual matches
    for p in remaining_amex:
        if p["_used"]:
            continue
        cargos = round(p.get("cargos", 0), 2)
        envio = p.get("fecha_envio")
        for item in list(remaining_corte):
            expected = round(float(item.get("amount", 0)), 2)
            corte_date = item.get("business_date") or item.get("source_date")
            if cargos == expected and _date_ge(envio, corte_date):
                p["_used"] = True
                remaining_corte.remove(item)
                matched_days.append({
                    **item,
                    "validated_by": "amex_exact",
                    "amex_cargo": cargos,
                    "amex_envio": envio,
                })
                logger.info(
                    "AMEX exact match: cargos=%.2f == corte %s AMEX=%.2f envio=%s",
                    cargos, corte_date, expected, envio,
                )
                break

    # Round 2: pair matches within same batch
    for _batch_id, batch_items in by_batch.items():
        unmatched_in_batch = [p for p in batch_items if not p["_used"]]
        while len(unmatched_in_batch) >= 2:
            found_pair = False
            for i in range(len(unmatched_in_batch)):
                if found_pair:
                    break
                for j in range(i + 1, len(unmatched_in_batch)):
                    a = unmatched_in_batch[i]
                    b = unmatched_in_batch[j]
                    # Must share same fecha_envio to be considered a split
                    if a.get("fecha_envio") != b.get("fecha_envio"):
                        continue
                    pair_sum = round(a.get("cargos", 0) + b.get("cargos", 0), 2)
                    pair_envio = a.get("fecha_envio")  # both same
                    for item in list(remaining_corte):
                        expected = round(float(item.get("amount", 0)), 2)
                        corte_date = item.get("business_date") or item.get("source_date")
                        if pair_sum == expected and _date_ge(pair_envio, corte_date):
                            a["_used"] = True
                            b["_used"] = True
                            remaining_corte.remove(item)
                            matched_days.append({
                                **item,
                                "validated_by": "amex_pair",
                                "amex_cargo_a": a.get("cargos"),
                                "amex_cargo_b": b.get("cargos"),
                                "amex_envio": pair_envio,
                            })
                            found_pair = True
                            break
            if not found_pair:
                break  # no more pairs possible
            unmatched_in_batch = [p for p in batch_items if not p["_used"]]

    pending_corte = remaining_corte
    unused_amex = [p for p in remaining_amex if not p["_used"]]
    return matched_days, pending_corte, unused_amex


def reconcile_bank_stage(
    expected_collections: list[dict[str, Any]],
    banorte_statement: dict[str, Any],
    amex_statement: dict[str, Any],
    *,
    tolerance: float = 0.0,
) -> dict[str, Any]:
    """Reconcile bank stage: validate AMEX payments against Corte and Banorte.

    Steps:
      1. Validate AMEX batch neto totals against Banorte SPEI AMEX deposits
      2. Match individual AMEX cargos (bruto) to Corte days
      3. Match paired AMEX cargos (same batch, same fecha_envio) to Corte days
    """
    exceptions: list[dict[str, Any]] = []

    if banorte_statement.get("status") != "ok":
        exceptions.append({"exception_key": "banorte_statement_requires_review", "details": banorte_statement})
    if amex_statement.get("status") != "ok":
        exceptions.append({"exception_key": "amex_statement_requires_review", "details": amex_statement})

    if not isinstance(expected_collections, list):
        expected_collections = []

    # Split expected by channel
    corte_amex = [
        dict(item) for item in expected_collections
        if isinstance(item, dict) and item.get("channel") == "amex"
    ]
    corte_others = [
        dict(item) for item in expected_collections
        if isinstance(item, dict) and item.get("channel") != "amex"
    ]

    amex_payments = amex_statement.get("payments", [])

    # Normalize AMEX payments to ensure required fields
    normalized_payments = []
    for p in amex_payments:
        np = dict(p)
        if "cargos" not in np:
            np["cargos"] = np.get("gross_amount", np.get("amount", 0))
        if "neto" not in np:
            np["neto"] = np.get("amount", np.get("gross_amount", 0))
        if "pago_num" not in np:
            np["pago_num"] = ""
        if "fecha_envio" not in np:
            np["fecha_envio"] = np.get("source_date")
        normalized_payments.append(np)
    amex_payments = normalized_payments

    # Step 1: Validate batch neto totals against Banorte
    by_batch: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for p in amex_payments:
        by_batch[p.get("pago_num", "")].append(p)

    banorte_amex_deposits = [
        d for d in banorte_statement.get("deposits", [])
        if isinstance(d, dict) and d.get("source") == "amex" and not d.get("matched", False)
    ]

    batch_validation: list[dict[str, Any]] = []
    for batch_id, batch_payments in by_batch.items():
        total_neto = round(sum(p.get("neto", 0) for p in batch_payments), 2)
        matched_deposit = next(
            (d for d in banorte_amex_deposits
             if not d.get("matched", False)
             and abs(float(d.get("amount", 0)) - total_neto) <= tolerance),
            None,
        )
        if matched_deposit:
            matched_deposit["matched"] = True
            batch_validation.append({
                "batch_id": batch_id,
                "total_neto": total_neto,
                "banorte_deposit": matched_deposit.get("amount"),
                "status": "ok",
            })
        else:
            batch_validation.append({
                "batch_id": batch_id,
                "total_neto": total_neto,
                "banorte_deposit": None,
                "status": "pending",
            })

    # Step 2 & 3: Match AMEX cargos to Corte days
    amex_matches, pending_corte_amex, unused_amex = _match_amex_to_corte(
        amex_payments, corte_amex
    )

    # Build expected collections for Banorte matching (non-AMEX channels)
    banorte_expected: list[dict[str, Any]] = []

    # AMEX payments that matched Corte -> still need Banorte SPEI validation
    for p in amex_payments:
        neto = p.get("neto", 0)
        if neto > 0:
            banorte_expected.append({
                "channel": "amex",
                "amount": neto,
                "expected_deposit": neto,
                "expected_payment_date": p.get("payment_date") or p.get("fecha_envio"),
                "source_date": p.get("fecha_envio"),
                "_original_amex": p,
            })

    for item in corte_others:
        banorte_expected.append({
            "channel": item.get("channel"),
            "amount": item.get("expected_deposit", item.get("amount", 0)),
            "expected_deposit": item.get("expected_deposit", item.get("amount", 0)),
            "expected_payment_date": item.get("expected_payment_date"),
            "source_date": item.get("source_date"),
            "_original_corte": item,
        })

    # Match expected against Banorte deposits
    available = [dict(item, matched=False) for item in banorte_statement.get("deposits", [])]
    matches: list[dict[str, Any]] = []
    pending_items: list[dict[str, Any]] = []

    # Group AMEX by expected_payment_date for consolidated SPEI matching
    expected_remaining = [dict(item, _matched=False) for item in banorte_expected if item.get("channel") == "amex"]
    for deposit in available:
        if deposit.get("matched"):
            continue
        channel = deposit.get("source")
        if not channel:
            continue
        operation_date = _date_key(deposit.get("operation_date"))
        candidates = [
            item for item in expected_remaining
            if not item["_matched"]
            and _date_key(item.get("expected_payment_date")) == operation_date
        ]
        if len(candidates) < 2:
            continue
        total = round(sum(float(item.get("expected_deposit", item.get("amount", 0))) for item in candidates), 2)
        if abs(float(deposit.get("amount", 0)) - total) <= tolerance:
            deposit["matched"] = True
            for item in candidates:
                item["_matched"] = True
            matches.append({
                "expected_group": [{k: v for k, v in item.items() if k != "_matched"} for item in candidates],
                "deposit": deposit,
            })

    # One-to-one matching for remaining
    for item in expected_remaining:
        if item["_matched"]:
            continue
        amount = round(float(item.get("expected_deposit", item.get("amount", 0))), 2)
        matched = next(
            (deposit for deposit in available
             if not deposit.get("matched")
             and deposit.get("source") == "amex"
             and abs(float(deposit.get("amount", 0)) - amount) <= tolerance),
            None,
        )
        if matched:
            matched["matched"] = True
            item["_matched"] = True
            matches.append({"expected": {k: v for k, v in item.items() if k != "_matched"}, "deposit": matched})
        else:
            pending_items.append({k: v for k, v in item.items() if not k.startswith("_")})

    # Non-AMEX channels
    others_remaining = [dict(item, _matched=False) for item in banorte_expected if item.get("channel") != "amex"]
    for item in others_remaining:
        if item["_matched"]:
            continue
        channel = item.get("channel")
        amount = round(float(item.get("expected_deposit", item.get("amount", 0))), 2)
        matched = next(
            (deposit for deposit in available
             if not deposit.get("matched")
             and deposit.get("source") == channel
             and abs(float(deposit.get("amount", 0)) - amount) <= tolerance),
            None,
        )
        if matched:
            matched["matched"] = True
            item["_matched"] = True
            matches.append({"expected": {k: v for k, v in item.items() if k != "_matched"}, "deposit": matched})
        else:
            pending_items.append({k: v for k, v in item.items() if not k.startswith("_")})

    pending: dict[str, float] = {}
    for item in pending_corte_amex:
        channel = str(item.get("channel", "amex"))
        pending[channel] = round(pending.get(channel, 0.0) + float(item.get("amount", 0)), 2)
    for item in pending_items:
        channel = str(item.get("channel", "unclassified"))
        pending[channel] = round(pending.get(channel, 0.0) + float(item.get("expected_deposit", item.get("amount", 0))), 2)

    # Status: bank_validated if no exceptions (even if some AMEX pending)
    has_exceptions = bool(exceptions)

    return {
        "status": "requires_review" if has_exceptions else "bank_validated",
        "matches": matches,
        "amex_matches": amex_matches,
        "batch_validation": batch_validation,
        "pending_items": pending_corte_amex + pending_items,
        "unused_amex": [{"cargos": p.get("cargos"), "neto": p.get("neto"), "fecha_envio": p.get("fecha_envio")} for p in unused_amex],
        "missing_funds": {
            "corte_to_amex": round(sum(float(item.get("amount", 0)) for item in pending_corte_amex), 2),
        },
        "pending_collections": pending,
        "additional_expenses": banorte_statement.get("domiciled_expenses", []),
        "exceptions": exceptions,
    }
