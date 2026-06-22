"""Build the traceable, canonical evidence package for Corte Santo.

The operating procedure separates three concepts that must not be mixed:

1. Reconciliation: terminal/platform evidence vs Wansoft.
2. Income registration: gross channel amounts, tips recorded separately, and
   dish courtesies added to cash.
3. Bank collection tracking: deposits received and amounts still pending.

This module performs the deterministic transformations between those concepts.
It never invents a missing value; incomplete or conflicting evidence produces
``requires_review``.
"""

from __future__ import annotations

from itertools import combinations
from copy import deepcopy
from typing import Any


def _amount(value: Any) -> float | None:
    if value in (None, "", "[CONFIRM]"):
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _global(entry: Any) -> float:
    if not isinstance(entry, dict):
        return 0.0
    consumo = _amount(entry.get("consumo")) or 0.0
    propina = _amount(entry.get("propina")) or 0.0
    return round(consumo + propina, 2)


def _sum_values(values: dict[str, Any], *keys: str) -> float | None:
    parts = [_amount(values.get(key)) for key in keys]
    if not all(part is not None for part in parts):
        return None
    return round(sum(part or 0.0 for part in parts), 2)


def _channel_amount(channels: Any, key: str) -> float | None:
    if not isinstance(channels, dict):
        return None
    value = channels.get(key)
    if isinstance(value, dict):
        return _amount(value.get("global"))
    return _amount(value)


def _optional_group_global(groups: dict[str, Any], key: str) -> float | None:
    return _global(groups.get(key)) if isinstance(groups.get(key), dict) else None


def _tip_total(groups: dict[str, Any], *keys: str) -> float | None:
    tips = []
    for key in keys:
        entry = groups.get(key)
        if not isinstance(entry, dict):
            continue
        tip = _amount(entry.get("propina"))
        if tip is not None:
            tips.append(tip)
    if not tips:
        return None
    return round(sum(tips), 2)


def _cxc_total(values: dict[str, Any]) -> float:
    total = _amount(values.get("monto_total"))
    if total is not None:
        return total
    consumo = _amount(values.get("consumo")) or 0.0
    propina = _amount(values.get("propina")) or 0.0
    return round(consumo + propina, 2)


def _amount_candidates(value: Any) -> list[float]:
    if not isinstance(value, list):
        return []
    candidates = []
    for item in value:
        amount = _amount(item)
        if amount is not None and amount > 0:
            candidates.append(amount)
    return candidates


def _best_candidate_sum(candidates: list[float], target: float, max_items: int = 10) -> float | None:
    clean = candidates[:max_items]
    if not clean:
        return None
    best = None
    best_delta = None
    for size in range(1, len(clean) + 1):
        for combo in combinations(clean, size):
            total = round(sum(combo), 2)
            delta = abs(round(total - target, 2))
            if best is None or delta < (best_delta or 0):
                best = total
                best_delta = delta
                if delta == 0:
                    return best
    return best


def _vision_by_type(vision_documents: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(vision_documents, list):
        return {}
    documents: dict[str, dict[str, Any]] = {}
    for item in vision_documents:
        if not isinstance(item, dict) or not item.get("document_type"):
            continue
        document_type = str(item.get("document_type"))
        if document_type == "cxc":
            values = item.get("values") if isinstance(item.get("values"), dict) else {}
            existing = documents.get(document_type)
            existing_values = existing.get("values") if isinstance(existing, dict) else {}
            if values.get("paypal_amount") or not existing_values.get("paypal_amount"):
                documents[document_type] = item
            continue
        documents[document_type] = item
    return documents


def _vision_documents_of_type(vision_documents: Any, document_type: str) -> list[dict[str, Any]]:
    if not isinstance(vision_documents, list):
        return []
    return [
        item
        for item in vision_documents
        if isinstance(item, dict) and item.get("document_type") == document_type
    ]


def _exception(key: str, details: dict[str, Any]) -> dict[str, Any]:
    return {
        "exception_key": key,
        "exception_type": "evidence_requires_review",
        "severity": "high",
        "status": "requires_review",
        "details": details,
    }


def _channel_from_raw(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    lower = value.lower().strip()
    if "debito" in lower or "dÃ©bito" in lower:
        return "debito"
    if "credito" in lower or "crÃ©dito" in lower:
        return "credito"
    if "amex" in lower:
        return "amex"
    if "efectivo" in lower:
        return "efectivo"
    if "transferencia" in lower or "spei" in lower:
        return "transferencia"
    if "paypal" in lower:
        return "paypal"
    if "uber" in lower:
        return "uber"
    if "rappi" in lower:
        return "rappi"
    return None


def _formula_from_terms(terms: Any, fallback_total: float) -> str:
    if not isinstance(terms, list):
        return f"={fallback_total:g}-{fallback_total:g}"
    parts = []
    for item in terms:
        amount = _amount(item)
        if amount is None:
            continue
        if not parts:
            parts.append(f"{amount:g}")
        elif amount < 0:
            parts.append(f"-{abs(amount):g}")
        else:
            parts.append(f"+{amount:g}")
    if not parts:
        return f"={fallback_total:g}-{fallback_total:g}"
    return "=" + "".join(parts)


def _cxc_paypal_note(values: dict[str, Any], total: float, channel: str | None) -> dict[str, Any]:
    lines = ["CXC"]
    for line in values.get("comment_lines") or []:
        text = str(line).strip()
        if text and text not in lines:
            lines.append(text)
    if not any("total" in line.lower() for line in lines):
        lines.append(f"TOTAL ${total:,.2f}")
    if channel:
        lines.append(f"Canal: {channel}")
    lines.append("======")
    return {
        "kind": "cxc",
        "amount": total,
        "formula": _formula_from_terms(values.get("paypal_formula_terms"), total),
        "comment": "\n".join(lines),
    }


def build_canonical_evidence(
    cierre_terminal: dict[str, Any],
    cierre_sistema: dict[str, Any],
    *,
    vision_documents: list[dict[str, Any]] | None = None,
    bank_statement: dict[str, Any] | None = None,
    income_channels: dict[str, Any] | None = None,
    income_adjustments: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create canonical reconciliation and income-registration values."""
    config = config or {}
    rules = config.get("evidence_rules")
    rules = rules if isinstance(rules, dict) else {}
    tolerance = _amount(rules.get("evidence_tolerance"))
    if tolerance is None:
        tolerance = 0.0
    income_photo_override_tolerance = _amount(rules.get("income_photo_override_tolerance"))
    if income_photo_override_tolerance is None:
        income_photo_override_tolerance = 0.0

    terminal = deepcopy(cierre_terminal or {})
    sistema = deepcopy(cierre_sistema or {})
    adjustments = income_adjustments if isinstance(income_adjustments, dict) else {}
    vision = _vision_by_type(vision_documents)
    exceptions: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []
    income_overrides: dict[str, float] = {}
    tip_overrides: dict[str, float] = {}

    for document_type, group in (("amex", "amex"), ("bancarias", "bancos")):
        document = vision.get(document_type)
        if not document:
            continue
        if document.get("status") != "extracted":
            exceptions.append(
                _exception(
                    f"{document_type}_vision_requires_review",
                    {"reason": document.get("review_reason")},
                )
            )
            continue
        values = document.get("values") if isinstance(document.get("values"), dict) else {}
        photo_total = _amount(values.get("total"))
        excel_total = _global(terminal.get(group))
        candidate_total = _best_candidate_sum(_amount_candidates(values.get("total_candidates")), excel_total)
        if candidate_total is not None and (
            photo_total is None or abs(candidate_total - excel_total) < abs(photo_total - excel_total)
        ):
            photo_total = candidate_total
        if photo_total is None:
            exceptions.append(
                _exception(f"{document_type}_photo_total_missing", {"document_type": document_type})
            )
            continue
        difference = round(photo_total - excel_total, 2)
        accepted_difference = abs(difference) <= tolerance
        if (
            document_type == "amex"
            and abs(difference) <= income_photo_override_tolerance
        ):
            income_overrides["amex"] = photo_total
            consumo = _amount(values.get("consumo"))
            if consumo is None:
                consumo = _amount(sistema.get("amex", {}).get("consumo"))
            if consumo is None:
                consumo = _amount(terminal.get("amex", {}).get("consumo"))
            if consumo is not None:
                tip_overrides["amex"] = round(photo_total - consumo, 2)
            accepted_difference = True
        checks.append(
            {
                "check_key": f"{document_type}_photo_vs_corte_excel",
                "photo_total": photo_total,
                "excel_total": excel_total,
                "difference": difference,
                "status": "ok" if accepted_difference else "requires_review",
            }
        )
        if not accepted_difference:
            exceptions.append(
                _exception(
                    f"{document_type}_photo_vs_excel_discrepancy",
                    {"photo_total": photo_total, "excel_total": excel_total, "difference": difference},
                )
            )

    tira_values = {}
    if vision.get("tira", {}).get("status") == "extracted":
        tira_values = vision["tira"].get("values") or {}
    bancarias_values = {}
    if vision.get("bancarias", {}).get("status") == "extracted":
        bancarias_values = vision["bancarias"].get("values") or {}
    amex_values = {}
    if vision.get("amex", {}).get("status") == "extracted":
        amex_values = vision["amex"].get("values") or {}

    tira_tips = _amount(tira_values.get("propina_total"))
    amex_tips = tip_overrides.get("amex")
    if amex_tips is None:
        amex_tips = _amount(amex_values.get("propina"))
    if amex_tips is None:
        amex_tips = _amount(sistema.get("amex", {}).get("propina"))
    bancarias_tips = _amount(bancarias_values.get("propina"))
    if bancarias_tips is None:
        bancarias_tips = _sum_values(bancarias_values, "propina_debito", "propina_credito")
    if bancarias_tips is None:
        bancarias_tips = _amount(sistema.get("bancos", {}).get("propina"))
    bank_tips_parts = [amex_tips, bancarias_tips]
    bank_tips = None
    if all(value is not None for value in bank_tips_parts):
        bank_tips = round(sum(value or 0.0 for value in bank_tips_parts), 2)

    selected_tips = None
    if tira_tips is not None and bank_tips is not None:
        selected_tips = min(tira_tips, bank_tips)
        checks.append(
            {
                "check_key": "lower_tip_rule",
                "tira_tips": tira_tips,
                "bank_photo_tips": bank_tips,
                "selected_tips": selected_tips,
                "status": "ok",
            }
        )
    if selected_tips is None and bank_tips is not None and tip_overrides:
        selected_tips = bank_tips
    if selected_tips is None:
        selected_tips = _tip_total(terminal, "amex", "bancos")
    if selected_tips is None:
        selected_tips = _tip_total(sistema, "amex", "bancos")

    cash_base = _global(sistema.get("efectivo"))
    detail_values = {}
    if vision.get("detalle_efectivo", {}).get("status") == "extracted":
        detail_values = vision["detalle_efectivo"].get("values") or {}
    courtesy = _amount(detail_values.get("cortesia_direccion"))
    if courtesy is None:
        courtesy = _amount(detail_values.get("cortesia"))
    if courtesy is None:
        for key in ("cortesia_platillos", "cortesias", "cortesia_platillo", "cortesia"):
            courtesy = _amount(tira_values.get(key))
            if courtesy is not None:
                break
    if courtesy is None:
        courtesy = _amount(adjustments.get("cortesia_direccion"))
    if courtesy is None:
        courtesy = 0.0
    income_cash = round(cash_base + courtesy, 2)

    # --- CXC (Cuenta por Cobrar) ---
    cxc_consumo = 0.0
    cxc_propina = 0.0
    cxc_channel = None
    cxc_note: dict[str, Any] | None = None
    cxc_doc = vision.get("cxc")
    cxc_total = 0.0
    paypal_cxc_total = 0.0
    paypal_note_values: dict[str, Any] = {"comment_lines": [], "paypal_formula_terms": []}
    paypal_note_channel = None
    for cxc_candidate in _vision_documents_of_type(vision_documents, "cxc"):
        candidate_values = cxc_candidate.get("values") if isinstance(cxc_candidate.get("values"), dict) else {}
        candidate_paypal = _amount(candidate_values.get("paypal_amount"))
        if candidate_paypal is None or candidate_paypal <= 0:
            continue
        candidate_propina = _amount(candidate_values.get("propina")) or 0.0
        candidate_channel = _channel_from_raw(candidate_values.get("canal"))
        paypal_cxc_total = round(paypal_cxc_total + candidate_paypal, 2)
        candidate_lines = [str(line).strip() for line in candidate_values.get("comment_lines") or [] if str(line).strip()]
        candidate_terms = list(candidate_values.get("paypal_formula_terms") or [])
        if candidate_channel == "cxc":
            paypal_note_values["comment_lines"] = [
                line for line in candidate_lines if line not in paypal_note_values["comment_lines"]
            ] + paypal_note_values["comment_lines"]
            paypal_note_values["paypal_formula_terms"] = candidate_terms + paypal_note_values["paypal_formula_terms"]
        else:
            for term in candidate_terms:
                paypal_note_values["paypal_formula_terms"].append(term)
        for line in ([] if candidate_channel == "cxc" else candidate_lines):
            text = str(line).strip()
            if text and text not in paypal_note_values["comment_lines"]:
                paypal_note_values["comment_lines"].append(text)
        if candidate_channel and candidate_channel != "cxc":
            paypal_note_channel = candidate_channel
        if candidate_propina > 0:
            selected_tips = round((selected_tips or 0.0) + candidate_propina, 2)
    if paypal_cxc_total > 0:
        cxc_note = _cxc_paypal_note(paypal_note_values, paypal_cxc_total, paypal_note_channel)

    if paypal_cxc_total <= 0 and cxc_doc and cxc_doc.get("status") != "extracted":
        exceptions.append(
            _exception(
                "cxc_vision_requires_review",
                {"reason": cxc_doc.get("review_reason")},
            )
        )
    elif paypal_cxc_total <= 0 and cxc_doc and cxc_doc.get("status") == "extracted":
        cxc_values = cxc_doc.get("values") or {}
        cxc_consumo = _amount(cxc_values.get("consumo")) or 0.0
        cxc_propina = _amount(cxc_values.get("propina")) or 0.0
        cxc_total = _cxc_total(cxc_values)
        paypal_amount = _amount(cxc_values.get("paypal_amount"))
        if paypal_amount is not None and paypal_amount > 0:
            cxc_total = paypal_amount
            paypal_cxc_total = round(paypal_cxc_total + paypal_amount, 2)
            if cxc_propina > 0:
                selected_tips = round((selected_tips or 0.0) + cxc_propina, 2)
        bancos_difference = abs(round(_global(terminal.get("bancos")) - _global(sistema.get("bancos")), 2))
        candidate_cxc_total = _best_candidate_sum(
            _amount_candidates(cxc_values.get("monto_candidates")),
            bancos_difference,
        )
        if candidate_cxc_total is not None and abs(candidate_cxc_total - bancos_difference) < abs(cxc_total - bancos_difference):
            cxc_total = candidate_cxc_total
            cxc_consumo = candidate_cxc_total
            cxc_propina = 0.0
        elif (
            cxc_propina > 0
            and abs(cxc_total - bancos_difference) <= 20.0
            and abs(cxc_total - bancos_difference) > tolerance
        ):
            ocr_delta = round(cxc_total - bancos_difference, 2)
            cxc_total = bancos_difference
            cxc_propina = round(max(cxc_propina - ocr_delta, 0.0), 2)
            cxc_consumo = round(max(cxc_total - cxc_propina, 0.0), 2)
        canal_raw = cxc_values.get("canal")
        if isinstance(canal_raw, str):
            canal_lower = canal_raw.lower().strip()
            if "debito" in canal_lower or "débito" in canal_lower:
                cxc_channel = "debito"
            elif "credito" in canal_lower or "crédito" in canal_lower:
                cxc_channel = "credito"
            elif "amex" in canal_lower:
                cxc_channel = "amex"
            elif "efectivo" in canal_lower:
                cxc_channel = "efectivo"
            elif "transferencia" in canal_lower:
                cxc_channel = "transferencia"
            elif "paypal" in canal_lower:
                cxc_channel = "paypal"
            elif "uber" in canal_lower:
                cxc_channel = "uber"
            elif "rappi" in canal_lower:
                cxc_channel = "rappi"
        if cxc_total > 0:
            cxc_note = _cxc_paypal_note(cxc_values, cxc_total, cxc_channel)

    if cxc_total > 0 and paypal_cxc_total <= 0:
        bancos_difference = round(_global(terminal.get("bancos")) - _global(sistema.get("bancos")), 2)
        cxc_difference = round(abs(bancos_difference) - cxc_total, 2)
        checks.append(
            {
                "check_key": "cxc_adjustment_vs_bancos_difference",
                "bancos_difference": bancos_difference,
                "cxc_total": cxc_total,
                "difference": cxc_difference,
                "channel": cxc_channel,
                "status": "ok" if abs(cxc_difference) <= tolerance else "requires_review",
            }
        )

    debit_channel = _channel_amount(income_channels, "debito")
    if debit_channel is None:
        debit_channel = _sum_values(bancarias_values, "consumo_debito", "propina_debito")
    credit_channel = _channel_amount(income_channels, "credito")
    if credit_channel is None:
        credit_channel = _sum_values(bancarias_values, "consumo_credito", "propina_credito")
    transferencia_channel = _channel_amount(income_channels, "transferencia")
    if transferencia_channel is None:
        transferencia_channel = _global(terminal.get("transferencia"))
    paypal_channel = _channel_amount(income_channels, "paypal")
    if paypal_channel is None:
        paypal_channel = _optional_group_global(terminal, "paypal")
    if paypal_channel is None:
        paypal_channel = 0.0
    uber_channel = _channel_amount(income_channels, "uber")
    if uber_channel is None:
        uber_channel = _optional_group_global(terminal, "uber")
    rappi_channel = _channel_amount(income_channels, "rappi")
    if rappi_channel is None:
        rappi_channel = _optional_group_global(terminal, "rappi")

    income_register = {
        "amex": income_overrides.get("amex", _global(sistema.get("amex"))),
        "bancos": _global(sistema.get("bancos")),
        "debito": debit_channel,
        "credito": credit_channel,
        "efectivo": income_cash,
        "transferencia": transferencia_channel,
        "plataformas": _global(terminal.get("plataformas")),
        "paypal": round((paypal_channel or 0.0) + paypal_cxc_total, 2),
        "uber": uber_channel,
        "rappi": rappi_channel,
        "propinas": selected_tips,
        "cortesia_direccion": courtesy,
    }

    if cxc_propina > 0 and paypal_cxc_total <= 0 and cxc_channel in income_register:
        income_register[cxc_channel] = round((income_register.get(cxc_channel) or 0.0) + cxc_propina, 2)

    bank_statement = bank_statement if isinstance(bank_statement, dict) else None
    if bank_statement and bank_statement.get("status") == "requires_review":
        exceptions.append(
            _exception(
                "bank_statement_requires_review",
                {
                    "review_reason": bank_statement.get("review_reason"),
                    "unclassified_deposits": bank_statement.get("unclassified_deposits", []),
                },
            )
        )

    return {
        "status": "requires_review" if exceptions else "ready",
        "reconciliation_inputs": {
            "cierre_terminal": terminal,
            "cierre_sistema": sistema,
        },
        "income_channels": income_channels if isinstance(income_channels, dict) else {},
        "income_adjustments": adjustments,
        "income_register": income_register,
        "income_cell_notes": {"paypal": cxc_note} if cxc_note else {},
        "selected_tips": selected_tips,
        "checks": checks,
        "bank_statement": bank_statement,
        "exceptions": exceptions,
    }
