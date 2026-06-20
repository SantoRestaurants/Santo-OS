from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _load_excel_parser():
    """Load the sibling corte_excel_parser module without requiring a package."""
    parser_path = Path(__file__).resolve().parent / "corte_excel_parser.py"
    spec = importlib.util.spec_from_file_location("corte_excel_parser", parser_path)
    if spec is None or spec.loader is None:  # pragma: no cover - import guard
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_sibling_module(module_name: str):
    """Load a sibling workflow module without requiring package installation."""
    module_path = Path(__file__).resolve().parent / f"{module_name}.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:  # pragma: no cover - import guard
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

WORKFLOW_KEY = "corte_santo_daily_sales_reconciliation"

REQUIRED_CONFIG_KEYS = (
    "restaurant_map",
    "drive_folder_map",
    "mandatory_attachments",
    "reviewer_map",
    "payment_forms",
    "thresholds",
)

REQUIRED_THRESHOLD_KEYS = ("reconciliation_tolerance",)

# Structural grouping of granular payment forms into the report columns used by
# the client "REVISION" document (Diferencias row). This is document structure,
# not a business assumption: it only decides how confirmed payment forms roll up
# into display groups. Forms not listed here fall back to their own key.
PAYMENT_FORM_GROUPS = {
    "amex": "amex",
    "banorte_debito": "bancos",
    "banorte_credito": "bancos",
    "efectivo": "efectivo",
    "transferencia": "transferencia",
    "paypal": "paypal",
    "uber_eats": "plataformas",
    "rappi": "plataformas",
}


def _json_dumps(data: dict[str, Any]) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _stable_hash(data: dict[str, Any]) -> str:
    return hashlib.sha256(_json_dumps(data).encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _load_json(path: str | None) -> dict[str, Any]:
    if not path:
        return {}

    with Path(path).open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)

    if not isinstance(loaded, dict):
        raise ValueError(f"Expected JSON object in {path}")

    return loaded


def _has_unconfirmed_value(value: Any) -> bool:
    if value in (None, "", "[CONFIRM]"):
        return True

    if isinstance(value, str):
        return "[CONFIRM]" in value

    if isinstance(value, dict):
        return any(_has_unconfirmed_value(item) for item in value.values())

    if isinstance(value, list):
        return any(_has_unconfirmed_value(item) for item in value)

    return False


def _missing_config(config: dict[str, Any]) -> list[str]:
    missing = []

    for key in REQUIRED_CONFIG_KEYS:
        if _has_unconfirmed_value(config.get(key)):
            missing.append(key)

    return missing


def _missing_payload(payload: dict[str, Any]) -> list[str]:
    missing = []

    for key in ("business_date", "restaurant_key"):
        if _has_unconfirmed_value(payload.get(key)):
            missing.append(f"payload.{key}")

    return missing


def _event(event_type: str, severity: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "aggregate_type": "workflow_run",
        "aggregate_id": None,
        "event_type": event_type,
        "severity": severity,
        "payload": payload,
        "created_at": _now(),
    }


def _watchdog(status: str, severity: str, message: str) -> dict[str, Any]:
    return {
        "check_key": "corte_santo.reconciliation",
        "status": status,
        "severity": severity,
        "message": message,
        "metadata": {},
        "checked_at": _now(),
    }


def _document_records(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = []

    for index, document in enumerate(documents):
        missing_hash = _has_unconfirmed_value(document.get("source_hash"))
        records.append(
            {
                "document_key": document.get("document_key") or f"document_{index + 1}",
                "document_type": document.get("document_type", "unclassified"),
                "source_system": document.get("source_system", "agent_mail"),
                "source_uri": document.get("source_uri"),
                "source_hash": None if missing_hash else document.get("source_hash"),
                "status": "requires_review" if missing_hash else "registered",
                "metadata": {
                    "original_filename": document.get("filename"),
                    "missing_source_hash": missing_hash,
                },
            }
        )

    return records


def _to_float(value: Any) -> float:
    if value in (None, "", "[CONFIRM]"):
        return 0.0
    return float(value)


def _form_global(entry: Any) -> dict[str, float]:
    """Normalize a payment-form entry to consumo / propina / global."""
    if not isinstance(entry, dict):
        entry = {}
    consumo = _to_float(entry.get("consumo"))
    propina = _to_float(entry.get("propina"))
    return {
        "consumo": consumo,
        "propina": propina,
        "global": round(consumo + propina, 2),
    }


def reconcile(
    cierre_terminal: dict[str, Any],
    cierre_sistema: dict[str, Any],
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Reconcile a Corte Santo day by payment form (forma de pago).

    The real Santo process compares two closings for the same day:

    - `cierre_terminal` ("Cierre Ter/Pla"): what the physical terminals and
      delivery platforms actually reported.
    - `cierre_sistema` ("Cierre Sistema"): what the Wansoft POS recorded.

    For every confirmed payment form it compares consumo + propina (global) of
    both sources. The grand totals (Total Real vs Total Sistema) must match
    within the confirmed tolerance. Any difference above tolerance is an
    exception that requires human review; no value is auto-completed.

    Args:
        cierre_terminal: payment_form -> {consumo, propina} reported by terminals.
        cierre_sistema: payment_form -> {consumo, propina} recorded by the system.
        config: confirmed config with `payment_forms` and `thresholds`.

    Returns:
        dict with status, per-form rows, grouped differences, totals and exceptions.
    """
    config = config or {}
    cierre_terminal = cierre_terminal or {}
    cierre_sistema = cierre_sistema or {}

    payment_forms = config.get("payment_forms")
    thresholds_config = config.get("thresholds", {})
    if not isinstance(thresholds_config, dict):
        thresholds_config = {}

    missing = []
    if _has_unconfirmed_value(payment_forms) or not isinstance(payment_forms, list):
        missing.append("payment_forms")
    for key in REQUIRED_THRESHOLD_KEYS:
        if _has_unconfirmed_value(thresholds_config.get(key)):
            missing.append(f"thresholds.{key}")

    if missing:
        return {
            "status": "requires_review",
            "by_form": [],
            "by_group": {},
            "totals": {"total_real": None, "total_sistema": None, "difference": None},
            "exceptions": [
                {
                    "exception_key": "missing_reconciliation_config",
                    "exception_type": "missing_config",
                    "severity": "medium",
                    "status": "requires_review",
                    "details": {"missing": missing},
                }
            ],
            "reconciled_at": _now(),
        }

    try:
        tolerance = float(thresholds_config["reconciliation_tolerance"])
    except (TypeError, ValueError):
        return {
            "status": "requires_review",
            "by_form": [],
            "by_group": {},
            "totals": {"total_real": None, "total_sistema": None, "difference": None},
            "exceptions": [
                {
                    "exception_key": "invalid_reconciliation_config",
                    "exception_type": "missing_config",
                    "severity": "medium",
                    "status": "requires_review",
                    "details": {"reason": "reconciliation_tolerance must be numeric."},
                }
            ],
            "reconciled_at": _now(),
        }

    if tolerance < 0:
        return {
            "status": "requires_review",
            "by_form": [],
            "by_group": {},
            "totals": {"total_real": None, "total_sistema": None, "difference": None},
            "exceptions": [
                {
                    "exception_key": "invalid_reconciliation_config",
                    "exception_type": "missing_config",
                    "severity": "medium",
                    "status": "requires_review",
                    "details": {"reason": "reconciliation_tolerance must be non-negative."},
                }
            ],
            "reconciled_at": _now(),
        }

    by_form: list[dict[str, Any]] = []
    by_group: dict[str, dict[str, float]] = {}
    total_real = 0.0
    total_sistema = 0.0
    exceptions: list[dict[str, Any]] = []

    for form in payment_forms:
        terminal = _form_global(cierre_terminal.get(form))
        sistema = _form_global(cierre_sistema.get(form))
        difference = round(terminal["global"] - sistema["global"], 2)

        total_real += terminal["global"]
        total_sistema += sistema["global"]

        group = PAYMENT_FORM_GROUPS.get(form, form)
        bucket = by_group.setdefault(
            group, {"terminal": 0.0, "sistema": 0.0, "difference": 0.0}
        )
        bucket["terminal"] = round(bucket["terminal"] + terminal["global"], 2)
        bucket["sistema"] = round(bucket["sistema"] + sistema["global"], 2)
        bucket["difference"] = round(bucket["difference"] + difference, 2)

        by_form.append(
            {
                "payment_form": form,
                "group": group,
                "terminal": terminal,
                "sistema": sistema,
                "difference": difference,
            }
        )

    total_real = round(total_real, 2)
    total_sistema = round(total_sistema, 2)
    total_difference = round(total_real - total_sistema, 2)

    for group, bucket in sorted(by_group.items()):
        if abs(bucket["difference"]) > tolerance:
            exceptions.append(
                {
                    "exception_key": f"payment_form_discrepancy_{group}",
                    "exception_type": "reconciliation_discrepancy",
                    "severity": "high",
                    "status": "requires_review",
                    "details": {
                        "group": group,
                        "terminal": bucket["terminal"],
                        "sistema": bucket["sistema"],
                        "difference": bucket["difference"],
                        "tolerance": tolerance,
                    },
                }
            )

    if abs(total_difference) > tolerance:
        exceptions.append(
            {
                "exception_key": "total_real_vs_sistema_discrepancy",
                "exception_type": "reconciliation_discrepancy",
                "severity": "high",
                "status": "requires_review",
                "details": {
                    "total_real": total_real,
                    "total_sistema": total_sistema,
                    "difference": total_difference,
                    "tolerance": tolerance,
                },
            }
        )

    status = "requires_review" if exceptions else "ready_for_approval"

    logging.info(
        "corte_santo_reconcile status=%s total_real=%.2f total_sistema=%.2f diff=%.2f",
        status,
        total_real,
        total_sistema,
        total_difference,
    )

    return {
        "status": status,
        "by_form": by_form,
        "by_group": by_group,
        "totals": {
            "total_real": total_real,
            "total_sistema": total_sistema,
            "difference": total_difference,
            "tolerance": tolerance,
        },
        "exceptions": exceptions,
        "reconciled_at": _now(),
    }


def build_revision_document(
    payload: dict[str, Any],
    config: dict[str, Any],
    reconciliation: dict[str, Any],
) -> dict[str, Any]:
    """
    Build the structured "REVISION" report the client stores in Drive.

    Mirrors the client format sections per unit: VTA POR DIA, VTA AL DIA,
    VTA META DEL MES, FORMATO DE CORTE, SALDOS, INGRESOS/GASTOS ADICIONALES,
    FALTA POR ENTRAR EN LA CUENTA and AJUSTES DEL DIA. Every figure comes from
    the payload; nothing about the unit, accounts or amounts is hardcoded.
    """
    restaurant_key = payload.get("restaurant_key")
    restaurant_map = config.get("restaurant_map", {})
    unit_display = restaurant_key
    if isinstance(restaurant_map, dict):
        unit_info = restaurant_map.get(restaurant_key)
        if isinstance(unit_info, dict) and unit_info.get("display_name"):
            unit_display = unit_info["display_name"]

    # VTA POR DIA + VTA AL DIA (accumulated across the listed rows).
    vta_por_dia_rows = payload.get("vta_por_dia", [])
    if not isinstance(vta_por_dia_rows, list):
        vta_por_dia_rows = []

    # If vta_por_dia is empty, try to read from Forecast workbook.
    if not vta_por_dia_rows:
        forecast_path = (payload.get("workbook_paths") or {}).get("forecast")
        if forecast_path:
            try:
                from workflows.corte_santo.workbook_writer import read_forecast_daily_sales
                forecast_layout = config.get("forecast_layout")
                vta_por_dia_rows = read_forecast_daily_sales(
                    forecast_path, layout=forecast_layout
                )
            except Exception:
                pass

    normalized_rows = []
    meta_acumulada = 0.0
    venta_acumulada = 0.0
    for row in vta_por_dia_rows:
        if not isinstance(row, dict):
            continue
        meta = _to_float(row.get("meta_vta"))
        venta = _to_float(row.get("venta_real"))
        meta_acumulada += meta
        venta_acumulada += venta
        normalized_rows.append(
            {
                "dia": row.get("dia"),
                "fecha": row.get("fecha"),
                "meta_vta": round(meta, 2),
                "venta_real": round(venta, 2),
                "diferencia": round(venta - meta, 2),
            }
        )

    meta_acumulada = round(meta_acumulada, 2)
    venta_acumulada = round(venta_acumulada, 2)
    vta_al_dia = {
        "meta_vta": meta_acumulada,
        "venta_real": venta_acumulada,
        "diferencia": round(venta_acumulada - meta_acumulada, 2),
        "pct_diferencia": round((venta_acumulada / meta_acumulada - 1) * 100, 2)
        if meta_acumulada
        else None,
    }

    # VTA META DEL MES.
    vta_meta_mes_in = payload.get("vta_meta_mes", {})
    if not isinstance(vta_meta_mes_in, dict):
        vta_meta_mes_in = {}
    meta_mes = _to_float(vta_meta_mes_in.get("meta_vta"))
    vta_meta_mes = {
        "meta_vta": round(meta_mes, 2),
        "venta_real": venta_acumulada,
        "diferencia": round(venta_acumulada - meta_mes, 2),
    }

    # SALDOS. TOTAL = saldo_banorte - prov_utilidades (observed client rule);
    # the payload may override `total` explicitly.
    saldos_in = payload.get("saldos", {})
    if not isinstance(saldos_in, dict):
        saldos_in = {}
    prov_aguinaldos = round(_to_float(saldos_in.get("prov_aguinaldos")), 2)
    saldo_banorte = round(_to_float(saldos_in.get("saldo_banorte")), 2)
    prov_utilidades = round(_to_float(saldos_in.get("prov_utilidades")), 2)
    if saldos_in.get("total") not in (None, "", "[CONFIRM]"):
        saldos_total = round(_to_float(saldos_in.get("total")), 2)
    else:
        saldos_total = round(saldo_banorte - prov_utilidades, 2)

    # FALTA POR ENTRAR EN LA CUENTA (cobros pendientes por canal).
    falta_in = payload.get("falta_por_entrar", {})
    if not isinstance(falta_in, dict):
        falta_in = {}
    falta_por_entrar = {key: round(_to_float(value), 2) for key, value in falta_in.items()}

    def _normalize_lines(items: Any) -> list[dict[str, Any]]:
        if not isinstance(items, list):
            return []
        out = []
        for item in items:
            if not isinstance(item, dict):
                continue
            out.append(
                {
                    "concepto": item.get("concepto") or item.get("descripcion"),
                    "importe": round(_to_float(item.get("importe")), 2),
                    "observaciones": item.get("observaciones"),
                }
            )
        return out

    formato_status = "BIEN" if reconciliation.get("status") == "ready_for_approval" else "REVISAR"

    return {
        "unidad": unit_display,
        "restaurant_key": restaurant_key,
        "business_date": payload.get("business_date"),
        "vta_por_dia": normalized_rows,
        "vta_al_dia": vta_al_dia,
        "vta_meta_mes": vta_meta_mes,
        "formato_corte": formato_status,
        "saldos": {
            "prov_aguinaldos": prov_aguinaldos,
            "saldo_banorte": saldo_banorte,
            "prov_utilidades": prov_utilidades,
            "total": saldos_total,
        },
        "ingresos_adicionales": _normalize_lines(payload.get("ingresos_adicionales")),
        "gastos_adicionales": _normalize_lines(payload.get("gastos_adicionales")),
        "falta_por_entrar": falta_por_entrar,
        "ajustes_del_dia": _normalize_lines(payload.get("ajustes_del_dia")),
        "reconciliation_totals": reconciliation.get("totals", {}),
    }


def run(input_payload: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    payload = input_payload.get("payload", {})
    if not isinstance(payload, dict):
        payload = {}

    dry_run = bool(input_payload.get("dry_run", True))
    business_date = payload.get("business_date")
    restaurant_key = payload.get("restaurant_key")
    legal_entity_key = payload.get("legal_entity_key")
    documents = payload.get("documents", [])
    if not isinstance(documents, list):
        documents = []

    idempotency_key = _stable_hash(
        {
            "workflow_key": WORKFLOW_KEY,
            "business_date": business_date,
            "restaurant_key": restaurant_key,
            "documents": [
                {
                    "document_key": item.get("document_key"),
                    "source_uri": item.get("source_uri"),
                    "source_hash": item.get("source_hash"),
                }
                for item in documents
                if isinstance(item, dict)
            ],
        }
    )

    logging.info(
        "corte_santo_start business_date=%s restaurant_key=%s dry_run=%s",
        business_date,
        restaurant_key,
        dry_run,
    )

    missing_config = _missing_config(config)
    missing_payload = _missing_payload(payload)
    document_records = _document_records([item for item in documents if isinstance(item, dict)])
    document_review_needed = any(record["status"] == "requires_review" for record in document_records)
    missing = missing_config + missing_payload

    # Check for missing mandatory attachments.
    provided_doc_types = {doc.get("document_type") for doc in documents if isinstance(doc, dict)}
    mandatory_attachments = config.get("mandatory_attachments", [])
    if not isinstance(mandatory_attachments, list):
        mandatory_attachments = []
    missing_attachments = [
        doc_type for doc_type in mandatory_attachments if doc_type not in provided_doc_types
    ]

    intake_blocked = bool(missing or document_review_needed or missing_attachments)
    status = "requires_review" if intake_blocked else "waiting_for_input"

    exceptions: list[dict[str, Any]] = []
    tasks = [
        {
            "task_key": "register_corte_evidence",
            "title": "Register Corte Santo evidence",
            "status": "requires_review" if document_review_needed or missing_attachments else "completed",
            "metadata": {"document_count": len(document_records)},
        },
        {
            "task_key": "review_corte_intake_config",
            "title": "Review Corte Santo intake configuration",
            "status": "requires_review" if missing_config else "completed",
            "metadata": {"missing_config": missing_config},
        },
    ]

    if missing:
        exceptions.append(
            {
                "exception_key": "missing_corte_intake_config_or_payload",
                "exception_type": "missing_config",
                "severity": "medium",
                "status": "requires_review",
                "details": {"missing": missing},
            }
        )

    if document_review_needed:
        exceptions.append(
            {
                "exception_key": "document_requires_review",
                "exception_type": "document_requires_review",
                "severity": "medium",
                "status": "requires_review",
                "details": {"reason": "One or more documents are missing source_hash."},
            }
        )

    if missing_attachments:
        exceptions.append(
            {
                "exception_key": "missing_mandatory_attachments",
                "exception_type": "missing_documents",
                "severity": "high",
                "status": "requires_review",
                "details": {"missing": missing_attachments},
            }
        )

    cierre_terminal = payload.get("cierre_terminal")
    cierre_sistema = payload.get("cierre_sistema")

    # Option B automation: if the corte figures were not provided as structured
    # data, extract them from the uploaded corte Excel workbook. Any column the
    # parser cannot confidently map becomes an exception -> requires_review.
    extraction_warnings: list[str] = []
    extraction_source: str | None = None
    if not intake_blocked and not (
        isinstance(cierre_terminal, dict) and isinstance(cierre_sistema, dict)
    ):
        corte_doc = next(
            (
                doc
                for doc in documents
                if isinstance(doc, dict)
                and doc.get("document_type") in ("corte_excel", "daily_sales_report")
                and doc.get("source_path")
            ),
            None,
        )
        if corte_doc is not None:
            parser = _load_excel_parser()
            if parser is None:
                extraction_warnings.append("excel_parser_unavailable")
            else:
                extracted = parser.parse_corte_excel(corte_doc["source_path"], config)
                extraction_warnings = list(extracted.get("warnings", []))
                extraction_source = corte_doc.get("document_key") or corte_doc.get("source_path")
                if not extraction_warnings:
                    cierre_terminal = extracted.get("cierre_terminal")
                    cierre_sistema = extracted.get("cierre_sistema")
                    payload = {
                        **payload,
                        "cierre_terminal": cierre_terminal,
                        "cierre_sistema": cierre_sistema,
                        "income_channels": payload.get("income_channels")
                        or extracted.get("income_channels"),
                        "income_channel_details": payload.get("income_channel_details")
                        or extracted.get("income_channel_details"),
                    }

            tasks.append(
                {
                    "task_key": "extract_corte_excel",
                    "title": "Extract Cierre Ter/Pla and Cierre Sistema from corte Excel",
                    "status": "requires_review" if extraction_warnings else "completed",
                    "metadata": {
                        "source": extraction_source,
                        "warnings": extraction_warnings,
                    },
                }
            )

            if extraction_warnings:
                exceptions.append(
                    {
                        "exception_key": "corte_excel_extraction_requires_review",
                        "exception_type": "extraction_requires_review",
                        "severity": "high",
                        "status": "requires_review",
                        "details": {
                            "source": extraction_source,
                            "warnings": extraction_warnings,
                        },
                    }
                )
                status = "requires_review"

    has_closing = isinstance(cierre_terminal, dict) and isinstance(cierre_sistema, dict)

    reconciliation: dict[str, Any] | None = None
    revision_document: dict[str, Any] | None = None
    canonical_evidence: dict[str, Any] | None = None

    if not intake_blocked and not extraction_warnings and has_closing:
        vision_documents = payload.get("vision_extractions")
        vision_config = config.get("vision_extraction") if isinstance(config, dict) else None
        vision_enabled = isinstance(vision_config, dict) and vision_config.get("enabled") is True
        if not isinstance(vision_documents, list) and vision_enabled:
            image_documents = [
                {
                    "document_type": doc.get("document_type"),
                    "image_path": doc.get("source_path"),
                    "source_hash": doc.get("source_hash"),
                }
                for doc in documents
                if isinstance(doc, dict)
                and doc.get("document_type") in ("tira", "bancarias", "amex", "detalle_efectivo", "cxc")
                and doc.get("source_path")
            ]
            if image_documents:
                vision_module = _load_sibling_module("vision_extractor")
                if vision_module is not None:
                    vision_batch = vision_module.extract_documents(image_documents, config)
                    vision_documents = vision_batch.get("documents", [])

        bank_statement = payload.get("bank_statement")
        if not isinstance(bank_statement, dict):
            bank_doc = next(
                (
                    doc
                    for doc in documents
                    if isinstance(doc, dict)
                    and doc.get("document_type") in ("banorte_statement", "bank_statement_banorte")
                    and doc.get("source_path")
                ),
                None,
            )
            if bank_doc is not None:
                bank_module = _load_sibling_module("bank_statement_parser")
                if bank_module is not None:
                    bank_statement = bank_module.parse_banorte_csv(bank_doc["source_path"], config)

        evidence_module = _load_sibling_module("evidence_builder")
        if evidence_module is not None:
            canonical_evidence = evidence_module.build_canonical_evidence(
                cierre_terminal,
                cierre_sistema,
                vision_documents=vision_documents,
                bank_statement=bank_statement,
                income_channels=payload.get("income_channels"),
                config=config,
            )
            canonical_inputs = canonical_evidence["reconciliation_inputs"]
            cierre_terminal = canonical_inputs["cierre_terminal"]
            cierre_sistema = canonical_inputs["cierre_sistema"]
            tasks.append(
                {
                    "task_key": "build_canonical_evidence",
                    "title": "Build traceable Corte Santo evidence package",
                    "status": "requires_review"
                    if canonical_evidence["status"] == "requires_review"
                    else "completed",
                    "metadata": {
                        "checks": canonical_evidence["checks"],
                        "income_register": canonical_evidence["income_register"],
                    },
                }
            )
            exceptions.extend(canonical_evidence["exceptions"])

        reconciliation = reconcile(cierre_terminal, cierre_sistema, config)
        status = reconciliation["status"]
        exceptions.extend(reconciliation.get("exceptions", []))
        if canonical_evidence and canonical_evidence["status"] == "requires_review":
            status = "requires_review"
            reconciliation = {
                **reconciliation,
                "status": "requires_review",
                "evidence_status": "requires_review",
            }

        tasks.append(
            {
                "task_key": "corte_reconciliation",
                "title": "Reconcile Cierre Ter/Pla vs Cierre Sistema by payment form",
                "status": "requires_review"
                if reconciliation["status"] == "requires_review"
                else "completed",
                "metadata": reconciliation["totals"],
            }
        )

        revision_document = build_revision_document(payload, config, reconciliation)
        tasks.append(
            {
                "task_key": "build_revision_document",
                "title": "Build REVISION report document",
                "status": "completed",
                "metadata": {
                    "unidad": revision_document["unidad"],
                    "formato_corte": revision_document["formato_corte"],
                },
            }
        )

    requires_review_reason: str | None = None
    if missing:
        requires_review_reason = ", ".join(missing)
    elif extraction_warnings:
        requires_review_reason = "corte_excel_extraction_requires_review"
    elif status == "requires_review":
        requires_review_reason = "reconciliation_discrepancy"

    result = {
        "status": status,
        "workflow_key": WORKFLOW_KEY,
        "workflow_run": {
            "workflow_key": WORKFLOW_KEY,
            "business_date": business_date,
            "restaurant_key": restaurant_key,
            "legal_entity_key": legal_entity_key,
            "status": status,
            "source_channel": input_payload.get("source_channel", "agent_mail"),
            "idempotency_key": idempotency_key,
            "input_payload": payload,
            "config_snapshot": config,
            "requires_review_reason": requires_review_reason,
            "reconciliation": reconciliation,
            "canonical_evidence": canonical_evidence,
            "revision_document": revision_document,
        },
        "documents": document_records,
        "tasks": tasks,
        "exceptions": exceptions,
        "events": [
            _event(
                "workflow_run.proposed",
                "info",
                {"workflow_key": WORKFLOW_KEY, "business_date": business_date},
            ),
            _event(
                "workflow_run.requires_review" if status == "requires_review" else "workflow_run.reconciled",
                "warning" if status == "requires_review" else "info",
                {
                    "workflow_key": WORKFLOW_KEY,
                    "missing": missing,
                    "reconciliation_totals": reconciliation.get("totals") if reconciliation else None,
                },
            ),
        ],
        "watchdog_log": [
            _watchdog(
                "requires_review" if status == "requires_review" else "ok",
                "warning" if status == "requires_review" else "info",
                "Corte Santo reconciliation or intake requires review."
                if status == "requires_review"
                else "Corte Santo reconciliation completed successfully.",
            )
        ],
        "dry_run": dry_run,
        "idempotency_key": idempotency_key,
    }

    logging.info("corte_santo_end status=%s", status)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Corte Santo reconciliation.")
    parser.add_argument("--input", required=True, help="Path to structured workflow input JSON.")
    parser.add_argument("--config", help="Path to Corte Santo config JSON.")
    parser.add_argument("--dry-run", action="store_true", help="Force dry_run=true.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        input_payload = _load_json(args.input)
        if args.dry_run:
            input_payload["dry_run"] = True
        config = _load_json(args.config)
        print(json.dumps(run(input_payload, config), indent=2, sort_keys=True))
        return 0
    except Exception:
        logging.exception("corte_santo_failure")
        return 1


if __name__ == "__main__":
    sys.exit(main())
