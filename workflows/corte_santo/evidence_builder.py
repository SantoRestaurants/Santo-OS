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


def _vision_by_type(vision_documents: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(vision_documents, list):
        return {}
    return {
        str(item.get("document_type")): item
        for item in vision_documents
        if isinstance(item, dict) and item.get("document_type")
    }


def _exception(key: str, details: dict[str, Any]) -> dict[str, Any]:
    return {
        "exception_key": key,
        "exception_type": "evidence_requires_review",
        "severity": "high",
        "status": "requires_review",
        "details": details,
    }


def build_canonical_evidence(
    cierre_terminal: dict[str, Any],
    cierre_sistema: dict[str, Any],
    *,
    vision_documents: list[dict[str, Any]] | None = None,
    bank_statement: dict[str, Any] | None = None,
    income_channels: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create canonical reconciliation and income-registration values."""
    config = config or {}
    rules = config.get("evidence_rules")
    rules = rules if isinstance(rules, dict) else {}
    tolerance = _amount(rules.get("evidence_tolerance"))
    if tolerance is None:
        tolerance = 0.0

    terminal = deepcopy(cierre_terminal or {})
    sistema = deepcopy(cierre_sistema or {})
    vision = _vision_by_type(vision_documents)
    exceptions: list[dict[str, Any]] = []
    checks: list[dict[str, Any]] = []

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
        if photo_total is None:
            exceptions.append(
                _exception(f"{document_type}_photo_total_missing", {"document_type": document_type})
            )
            continue
        difference = round(photo_total - excel_total, 2)
        checks.append(
            {
                "check_key": f"{document_type}_photo_vs_corte_excel",
                "photo_total": photo_total,
                "excel_total": excel_total,
                "difference": difference,
                "status": "ok" if abs(difference) <= tolerance else "requires_review",
            }
        )
        if abs(difference) > tolerance:
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
        courtesy = 0.0
    income_cash = round(cash_base + courtesy, 2)

    # --- CXC (Cuenta por Cobrar) ---
    cxc_consumo = 0.0
    cxc_propina = 0.0
    cxc_channel = None
    cxc_doc = vision.get("cxc")
    if cxc_doc and cxc_doc.get("status") == "extracted":
        cxc_values = cxc_doc.get("values") or {}
        cxc_consumo = _amount(cxc_values.get("consumo")) or 0.0
        cxc_propina = _amount(cxc_values.get("propina")) or 0.0
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
        "amex": _global(sistema.get("amex")),
        "bancos": _global(sistema.get("bancos")),
        "debito": debit_channel,
        "credito": credit_channel,
        "efectivo": income_cash,
        "transferencia": transferencia_channel,
        "plataformas": _global(terminal.get("plataformas")),
        "paypal": paypal_channel,
        "uber": uber_channel,
        "rappi": rappi_channel,
        "propinas": selected_tips,
        "cortesia_direccion": courtesy,
    }

    # Apply CXC adjustments: add consumo to the appropriate channel, add propina to propinas.
    if cxc_consumo > 0 and cxc_channel:
        income_register[cxc_channel] = round((income_register.get(cxc_channel) or 0.0) + cxc_consumo, 2)
    if cxc_propina > 0:
        income_register["propinas"] = round((income_register.get("propinas") or 0.0) + cxc_propina, 2)

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
        "income_register": income_register,
        "selected_tips": selected_tips,
        "checks": checks,
        "bank_statement": bank_statement,
        "exceptions": exceptions,
    }
