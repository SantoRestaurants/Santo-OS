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


def _pending_amount(item: dict[str, Any]) -> float:
    """Operational outstanding balance uses the Corte/source amount.

    AMEX statements can enrich an item with the net bank deposit expected after
    commissions, but the user-facing "falta por entrar" ledger is keyed to the
    original Corte sale amount by source date.
    """
    return round(float(item.get("amount", item.get("expected_deposit", 0)) or 0), 2)


def _bank_match_amount(item: dict[str, Any]) -> float:
    return round(float(item.get("expected_deposit", item.get("amount", 0)) or 0), 2)


def _ledger_key(item: dict[str, Any]) -> tuple[str, str, float, str]:
    return (
        str(item.get("channel") or "unclassified"),
        str(item.get("source_date") or item.get("business_date") or ""),
        _pending_amount(item),
        str(item.get("receivable_key") or item.get("receivable_id") or item.get("expected_payment_date") or ""),
    )


def _operation_is_after_source(deposit: dict[str, Any], item: dict[str, Any]) -> bool:
    operation_date = _date_key(deposit.get("operation_date"))
    source_date = _date_key(item.get("source_date") or item.get("business_date"))
    return bool(operation_date and source_date and operation_date > source_date)


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
        if isinstance(envio_raw, float) and xlrd is not None:
            try:
                envio_raw = xlrd.xldate_as_datetime(envio_raw, book_datemode).strftime("%Y-%m-%d")
            except Exception:
                envio_raw = str(envio_raw)
        envio_date = _date_key(envio_raw)

        date_raw = row[date_col] if date_col is not None and date_col < len(row) else None
        if isinstance(date_raw, float) and xlrd is not None:
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
        logger.debug("  corte[%d]: amount=%.2f date=%s", idx, item.get("amount", 0), item.get("business_date") or item.get("source_date"))
    for idx, p in enumerate(remaining_amex[:5]):
        logger.debug("  amex[%d]: cargos=%.2f envio=%s pago=%s", idx, p.get("cargos", 0), p.get("fecha_envio"), p.get("pago_num", ""))

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
        neto = round(p.get("neto", p.get("amount", 0)), 2)
        envio = p.get("fecha_envio")
        for item in list(remaining_corte):
            expected = round(float(item.get("amount", 0)), 2)
            expected_net = round(float(item.get("expected_deposit", expected)), 2)
            corte_date = item.get("business_date") or item.get("source_date")
            date_ok = _date_ge(envio, corte_date)
            gross_match = cargos == expected
            legacy_net_match = neto == expected_net and expected == expected_net
            if gross_match or legacy_net_match:
                if not date_ok:
                    logger.debug(
                        "AMEX date fail: cargos=%.2f == corte %s AMEX=%.2f but envio=%s < corte_date=%s",
                        cargos, corte_date, expected, envio, corte_date,
                    )
                else:
                    logger.info(
                        "AMEX exact match: cargos=%.2f == corte %s AMEX=%.2f envio=%s",
                        cargos, corte_date, expected, envio,
                    )
            if (gross_match or legacy_net_match) and date_ok:
                p["_used"] = True
                remaining_corte.remove(item)
                matched_days.append({
                    **item,
                    "amount": cargos if legacy_net_match else expected,
                    "validated_by": "amex_exact",
                    "amex_cargo": cargos,
                    "amex_envio": envio,
                    "expected_deposit": p.get("neto", item.get("expected_deposit", item.get("amount", 0))),
                    "expected_payment_date": p.get("payment_date") or p.get("fecha_envio"),
                    "_original_amex": p,
                })
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
                    pair_net = round(float(a.get("neto", 0)) + float(b.get("neto", 0)), 2)
                    pair_envio = a.get("fecha_envio")  # both same
                    for item in list(remaining_corte):
                        expected = round(float(item.get("amount", 0)), 2)
                        expected_net = round(float(item.get("expected_deposit", expected)), 2)
                        corte_date = item.get("business_date") or item.get("source_date")
                        gross_match = pair_sum == expected
                        legacy_net_match = pair_net == expected_net and expected == expected_net
                        if (gross_match or legacy_net_match) and _date_ge(pair_envio, corte_date):
                            a["_used"] = True
                            b["_used"] = True
                            remaining_corte.remove(item)
                            matched_days.append({
                                **item,
                                "amount": pair_sum if legacy_net_match else expected,
                                "validated_by": "amex_pair",
                                "amex_cargo_a": a.get("cargos"),
                                "amex_cargo_b": b.get("cargos"),
                                "amex_envio": pair_envio,
                                "expected_deposit": round(float(a.get("neto", 0)) + float(b.get("neto", 0)), 2),
                                "expected_payment_date": a.get("payment_date") or b.get("payment_date") or pair_envio,
                                "_original_amex": [a, b],
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
    business_date: str | None = None,
    settlement_rules: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Reconcile bank stage: validate AMEX payments against Corte and Banorte.

    Steps:
      1. Validate AMEX batch neto totals against Banorte SPEI AMEX deposits
      2. Match individual AMEX cargos (bruto) to Corte days
      3. Match paired AMEX cargos (same batch, same fecha_envio) to Corte days
    """
    exceptions: list[dict[str, Any]] = []
    settlement_rules = settlement_rules or {}

    if banorte_statement.get("status") != "ok":
        exceptions.append({"exception_key": "banorte_statement_requires_review", "details": banorte_statement})
    if amex_statement.get("status") != "ok":
        exceptions.append({"exception_key": "amex_statement_requires_review", "details": amex_statement})

    if not isinstance(expected_collections, list):
        expected_collections = []

    normalized_expected: list[dict[str, Any]] = []
    seen_expected: set[tuple[str, str, float, str]] = set()
    for raw in expected_collections:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        channel = str(item.get("channel") or "unclassified").lower()
        if channel in ("terminal", "terminal_banorte"):
            channel = "banorte"
        if channel in ("plataforma", "plataformas", "uber_eats", "ubereats"):
            channel = "uber" if "uber" in channel else channel
        item["channel"] = channel
        item["source_date"] = str(item.get("source_date") or item.get("business_date") or "")
        item["business_date"] = str(item.get("business_date") or item.get("source_date") or "")
        item["amount"] = _pending_amount(item)
        item["expected_deposit"] = _bank_match_amount(item)
        key = _ledger_key(item)
        if key in seen_expected:
            continue
        seen_expected.add(key)
        normalized_expected.append(item)

    corte_amex = [dict(item) for item in normalized_expected if item.get("channel") == "amex"]
    corte_others = [dict(item) for item in normalized_expected if item.get("channel") != "amex"]

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

    # Only Corte-created ledger rows are eligible for bank matching. AMEX export
    # rows can enrich those rows with net deposit/payment date, but cannot create
    # new outstanding items on their own.
    banorte_expected: list[dict[str, Any]] = []
    for item in amex_matches:
        enriched = {k: v for k, v in item.items() if not str(k).startswith("_")}
        enriched["channel"] = "amex"
        enriched["amount"] = _pending_amount(item)
        enriched["expected_deposit"] = _bank_match_amount(item)
        banorte_expected.append(enriched)
    for item in pending_corte_amex:
        pending_items_date = str(item.get("source_date") or item.get("business_date") or "")
        banorte_expected.append({
            **item,
            "channel": "amex",
            "amount": _pending_amount(item),
            "expected_deposit": _bank_match_amount(item),
            "source_date": pending_items_date,
            "status": "pendiente_reporte_amex",
        })
    for item in corte_others:
        banorte_expected.append({
            **item,
            "amount": _pending_amount(item),
            "expected_deposit": _bank_match_amount(item),
            "_original_corte": item,
        })

    # Match expected against Banorte deposits
    available = [dict(item, matched=False) for item in banorte_statement.get("deposits", [])]
    matches: list[dict[str, Any]] = []
    pending_items: list[dict[str, Any]] = []

    max_banorte_date_str = max(
        (_date_key(d.get("operation_date")) for d in banorte_statement.get("deposits", []) if _date_key(d.get("operation_date"))),
        default=None
    )
    min_banorte_date_str = min(
        (_date_key(d.get("operation_date")) for d in banorte_statement.get("deposits", []) if _date_key(d.get("operation_date"))),
        default=None
    )

    # Group AMEX by expected_payment_date for consolidated SPEI matching
    expected_remaining = [dict(item, _matched=False) for item in banorte_expected if item.get("channel") == "amex"]
    for item in expected_remaining:
        if item.get("status") == "pendiente_reporte_amex" and not item.get("expected_payment_date"):
            item["_matched"] = True
            pending_items.append({k: v for k, v in item.items() if not k.startswith("_")})
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
        dep_amount = round(float(deposit.get("amount", 0)), 2)
        diff = round(dep_amount - total, 2)
        
        # Exact match or fuzzy match for AMEX (up to 5% difference)
        max_diff = max(100.0, total * 0.05)
        if abs(diff) <= max_diff:
            deposit["matched"] = True
            for item in candidates:
                item["_matched"] = True
            
            # If difference is larger than normal tolerance, mark it as liquidacion diff
            if abs(diff) > tolerance:
                matches.append({
                    "expected_group": [{k: v for k, v in item.items() if k != "_matched"} for item in candidates],
                    "deposit": deposit,
                    "status": "diferencia_liquidacion_amex",
                    "diferencia": diff
                })
            else:
                matches.append({
                    "expected_group": [{k: v for k, v in item.items() if k != "_matched"} for item in candidates],
                    "deposit": deposit,
                })

    # One-to-one matching for remaining
    for item in expected_remaining:
        if item["_matched"]:
            continue
        amount = round(float(item.get("expected_deposit", item.get("amount", 0))), 2)
        expected_date = _date_key(item.get("expected_payment_date"))
        
        # Exact match by amount
        matched = next(
            (deposit for deposit in available
             if not deposit.get("matched")
             and deposit.get("source") == "amex"
             and abs(float(deposit.get("amount", 0)) - amount) <= tolerance),
            None,
        )
        
        # Or match by exact date if it's the only one
        if not matched and expected_date:
            date_matches = [d for d in available if not d.get("matched") and d.get("source") == "amex" and _date_key(d.get("operation_date")) == expected_date]
            if len(date_matches) == 1:
                matched = date_matches[0]

        if matched:
            diff = round(float(matched.get("amount", 0)) - amount, 2)
            matched["matched"] = True
            item["_matched"] = True
            if abs(diff) <= tolerance:
                matches.append({"expected": {k: v for k, v in item.items() if k != "_matched"}, "deposit": matched})
            else:
                matched_item = {k: v for k, v in item.items() if k != "_matched"}
                matched_item["status"] = "diferencia_liquidacion_amex"
                matched_item["diferencia"] = diff
                matches.append({"expected": matched_item, "deposit": matched})
        else:
            unmatched_item = {k: v for k, v in item.items() if not k.startswith("_")}
            if max_banorte_date_str and expected_date and expected_date > max_banorte_date_str:
                unmatched_item["status"] = "programado"
            elif min_banorte_date_str and expected_date and expected_date < min_banorte_date_str:
                unmatched_item["status"] = "fuera_de_rango"
            else:
                unmatched_item["status"] = "pendiente"
            pending_items.append(unmatched_item)

    # Non-AMEX channels
    others_remaining = [
        dict(
            item,
            _matched=False,
            _remaining=round(float(item.get("expected_deposit", item.get("amount", 0)) or 0), 2),
        )
        for item in banorte_expected
        if item.get("channel") != "amex"
    ]
    for channel in set(item.get("channel") for item in others_remaining):
        channel_items = [item for item in others_remaining if item.get("channel") == channel and not item["_matched"]]
        if not channel_items:
            continue

        # Try to match single deposit or deposit group against expected items
        # First group available deposits by date
        available_channel_deps = [d for d in available if not d.get("matched") and d.get("source") == channel]
        deps_by_date: dict[str, list[dict[str, Any]]] = {}
        for d in available_channel_deps:
            d_date = _date_key(d.get("operation_date"))
            if d_date:
                deps_by_date.setdefault(d_date, []).append(d)

        # 1. Try to match a single expected item against a group of deposits on the same day
        for item in channel_items:
            if item["_matched"]:
                continue
            item_amount = round(float(item.get("expected_deposit", item.get("amount", 0))), 2)
            
            for date_key, deps in deps_by_date.items():
                unmatched_deps = [
                    d for d in deps
                    if not d.get("matched") and _operation_is_after_source(d, item)
                ]
                if not unmatched_deps:
                    continue
                # If the sum of ALL unmatched deposits for this channel on this date matches the single item
                total_deps = round(sum(float(d.get("amount", 0)) for d in unmatched_deps), 2)
                if abs(total_deps - item_amount) <= tolerance:
                    item["_matched"] = True
                    for d in unmatched_deps:
                        d["matched"] = True
                    matches.append({
                        "expected": {k: v for k, v in item.items() if k != "_matched"},
                        "deposit_group": unmatched_deps
                    })
                    break

        # 2. Try to find single deposits that match the sum of a contiguous window of channel_items
        for deposit in available:
            if deposit.get("matched") or deposit.get("source") != channel:
                continue
            dep_amount = round(float(deposit.get("amount", 0)), 2)
            
            # Try to match single item first
            single_match = next((
                i for i in channel_items
                if not i["_matched"]
                and _operation_is_after_source(deposit, i)
                and abs(float(i.get("expected_deposit", i.get("amount", 0))) - dep_amount) <= tolerance
            ), None)
            if single_match:
                single_match["_matched"] = True
                deposit["matched"] = True
                matches.append({"expected": {k: v for k, v in single_match.items() if k != "_matched"}, "deposit": deposit})
                continue
            
            # Try to match contiguous groups (up to 5 items) for terminal / agrupaciones
            found_group = False
            for i in range(len(channel_items)):
                if found_group:
                    break
                if channel_items[i]["_matched"]:
                    continue
                group = []
                group_sum = 0.0
                for j in range(i, min(i + 5, len(channel_items))):
                    if channel_items[j]["_matched"] or not _operation_is_after_source(deposit, channel_items[j]):
                        break
                    group.append(channel_items[j])
                    group_sum += float(channel_items[j].get("expected_deposit", channel_items[j].get("amount", 0)))
                    if abs(group_sum - dep_amount) <= tolerance:
                        found_group = True
                        for item in group:
                            item["_matched"] = True
                        deposit["matched"] = True
                        matches.append({
                            "expected_group": [{k: v for k, v in item.items() if k != "_matched"} for item in group],
                            "deposit": deposit
                        })
                        break

        rule = settlement_rules.get(str(channel), {})
        mode = rule.get("mode") if isinstance(rule, dict) else None

        # Uber and Rappi statements land net of platform deductions. A payout
        # therefore closes the gross Corte ledger through the day before the
        # deposit; comparing the two amounts directly would leave commissions
        # falsely outstanding forever.
        if mode == "deposit_cutoff":
            for deposit in sorted(
                (d for d in available if not d.get("matched") and d.get("source") == channel),
                key=lambda d: _date_key(d.get("operation_date")) or "",
            ):
                eligible = [
                    item for item in channel_items
                    if not item["_matched"] and _operation_is_after_source(deposit, item)
                ]
                if not eligible:
                    continue
                for item in eligible:
                    item["_matched"] = True
                deposit["matched"] = True
                matches.append({
                    "expected_group": [
                        {k: v for k, v in item.items() if not k.startswith("_")}
                        for item in eligible
                    ],
                    "deposit": deposit,
                    "settlement_mode": "deposit_cutoff",
                })

        # Banorte terminal settlements are gross, can arrive in several rows,
        # and may only partially cover the latest Corte day. Apply later-dated
        # deposits FIFO and retain only the true residual as outstanding.
        if mode == "fifo_partial":
            ordered_items = sorted(
                (item for item in channel_items if not item["_matched"]),
                key=lambda item: _date_key(item.get("source_date") or item.get("business_date")) or "",
            )
            for deposit in sorted(
                (d for d in available if not d.get("matched") and d.get("source") == channel),
                key=lambda d: _date_key(d.get("operation_date")) or "",
            ):
                deposit_remaining = round(float(deposit.get("amount", 0) or 0), 2)
                allocations = []
                for item in ordered_items:
                    if item["_matched"] or deposit_remaining <= tolerance:
                        continue
                    if not _operation_is_after_source(deposit, item):
                        continue
                    allocation = round(min(float(item["_remaining"]), deposit_remaining), 2)
                    if allocation <= 0:
                        continue
                    item["_remaining"] = round(float(item["_remaining"]) - allocation, 2)
                    deposit_remaining = round(deposit_remaining - allocation, 2)
                    allocations.append({
                        "business_date": item.get("business_date"),
                        "source_date": item.get("source_date"),
                        "amount": allocation,
                        "receivable_id": item.get("receivable_id"),
                        "receivable_key": item.get("receivable_key"),
                    })
                    if item["_remaining"] <= tolerance:
                        item["_matched"] = True
                if allocations:
                    deposit["matched"] = True
                    matches.append({
                        "allocations": allocations,
                        "deposit": deposit,
                        "unapplied_amount": max(0.0, deposit_remaining),
                        "settlement_mode": "fifo_partial",
                    })
                        
    for item in others_remaining:
        if not item["_matched"]:
            pending_item = {k: v for k, v in item.items() if not k.startswith("_")}
            if float(item.get("_remaining", 0)) < float(item.get("expected_deposit", item.get("amount", 0)) or 0):
                residual = round(float(item["_remaining"]), 2)
                original = round(float(item.get("amount", item.get("expected_deposit", 0)) or 0), 2)
                pending_item["original_amount"] = original
                pending_item["settled_amount"] = round(original - residual, 2)
                pending_item["amount"] = residual
                pending_item["expected_deposit"] = residual
                pending_item["status"] = "parcialmente_depositado"
            pending_items.append(pending_item)

    pending: dict[str, float] = {}
    platforms_pending = []
    final_pending_items = []
    
    seen_pending: set[tuple[str, str, float, str]] = set()
    # We use pending_items directly since it contains all unmatched ledger items.
    for item in pending_items:
        channel = str(item.get("channel", "unclassified"))
        item["amount"] = _pending_amount(item)
        item["expected_deposit"] = _bank_match_amount(item)
        pending_key = _ledger_key(item)
        if pending_key in seen_pending:
            continue
        seen_pending.add(pending_key)
        if channel in ("uber", "rappi", "plataformas", "plataforma"):
            item["status"] = "pendiente_reporte_plataforma"
            platforms_pending.append(item)
        status = str(item.get("status") or "")
        if channel != "amex" and status == "programado":
            continue
        label = "uber" if channel in ("plataformas", "plataforma") else channel
        if status == "fuera_de_rango":
            label = f"{label}_fuera_de_rango"
        pending[label] = round(pending.get(label, 0.0) + _pending_amount(item), 2)
        final_pending_items.append(item)
    pending_items = final_pending_items

    # Status: bank_validated if no exceptions (even if some AMEX pending)
    has_exceptions = bool(exceptions)

    additional_expenses = list(
        banorte_statement.get("additional_expenses")
        or banorte_statement.get("domiciled_expenses")
        or []
    )
    if business_date:
        additional_expenses = [
            item for item in additional_expenses
            if _date_key(item.get("operation_date")) == _date_key(business_date)
        ]

    return {
        "status": "requires_review" if has_exceptions else "bank_validated",
        "matches": matches,
        "amex_matches": amex_matches,
        "batch_validation": batch_validation,
        "pending_items": pending_items,
        "platforms_pending": platforms_pending,
        "unused_amex": [{"cargos": p.get("cargos"), "neto": p.get("neto"), "fecha_envio": p.get("fecha_envio")} for p in unused_amex],
        "missing_funds": {
            "corte_to_amex": round(sum(float(item.get("amount", 0)) for item in pending_corte_amex), 2),
        },
        "pending_collections": pending,
        "additional_expenses": additional_expenses,
        "exceptions": exceptions,
    }
