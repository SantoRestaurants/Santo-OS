"""Executable two-stage runtime for Corte Santo."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

from services.agent_mail.notifications import send_notification
from services.drive_connector.connector import replace_document_content


def _load(name: str):
    path = Path(__file__).resolve().parent / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"corte_santo_{name}", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"module_unavailable:{name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _income_channels(payload: dict[str, Any], workflow_result: dict[str, Any]) -> dict[str, Any]:
    explicit = payload.get("income_channels")
    if isinstance(explicit, dict):
        return explicit
    canonical = workflow_result.get("workflow_run", {}).get("canonical_evidence", {})
    register = canonical.get("income_register", {}) if isinstance(canonical, dict) else {}
    return {
        k: (register.get(k) if register.get(k) is not None else 0.0)
        for k in ["amex", "debito", "credito", "efectivo", "paypal", "uber", "rappi", "propinas"]
    }


def _income_cell_notes(payload: dict[str, Any], workflow_result: dict[str, Any]) -> dict[str, Any]:
    explicit = payload.get("income_cell_notes")
    if isinstance(explicit, dict):
        return explicit
    canonical = workflow_result.get("workflow_run", {}).get("canonical_evidence", {})
    notes = canonical.get("income_cell_notes", {}) if isinstance(canonical, dict) else {}
    return notes if isinstance(notes, dict) else {}


def _bank_write_channels(payload: dict[str, Any]) -> dict[str, Any]:
    """Build columnar values for the Ingresos workbook during bank validation.

    The full ``income_register`` is the source of truth because it already
    includes courtesy adjustments (``cortesia_*``) inside ``efectivo`` and
    exposes ``propinas`` separately.  When available the register values are
    used directly so the blue sheet matches the yellow sheet written by the
    initial stage.  When not available we fall back to the raw
    ``income_channels`` and add any courtesy amounts to ``efectivo``.
    """
    register = payload.get("income_register")
    use_register = isinstance(register, dict) and bool(register)
    if not use_register:
        register = {}

    channels = dict(payload.get("income_channels") or {})

    layout_keys = ["amex", "debito", "credito", "efectivo", "paypal", "uber", "rappi", "propinas", "transferencia"]
    result: dict[str, Any] = {}
    for key in layout_keys:
        if use_register:
            val = register.get(key) if register.get(key) is not None else channels.get(key)
        else:
            val = channels.get(key)
        result[key] = float(val) if val is not None else 0.0

    # When using the raw income_channels (no income_register) the courtesy
    # amounts are not yet inside efectivo, so we add them now.
    if not use_register:
        cortesia = 0.0
        for key in ("cortesia_direccion", "cortesia_platillos", "cortesias", "cortesia_platillo", "cortesia"):
            val = register.get(key)
            if val is not None:
                cortesia += float(val)
        if cortesia:
            result["efectivo"] = result.get("efectivo", 0.0) + cortesia

    return result


def _deliver_and_update(
    result: dict[str, Any],
    payload: dict[str, Any],
    dry_run: bool,
    *,
    required_drive_keys: tuple[str, ...],
) -> dict[str, Any]:
    if result.get("status") not in ("waiting_for_input", "completed", "requires_review"):
        result["notification_delivery"] = {
            "status": "not_attempted",
            "reason": "workflow_stage_requires_review",
        }
        result["drive_updates"] = []
        return result

    is_requires_review = result.get("status") == "requires_review"

    drive_file_ids = payload.get("drive_file_ids", {})
    missing_drive_keys = [
        key for key in required_drive_keys if not isinstance(drive_file_ids, dict) or not drive_file_ids.get(key)
    ]
    if missing_drive_keys:
        if dry_run:
            result["missing_drive_keys"] = missing_drive_keys
            result["drive_updates"] = []
            result["notification_delivery"] = send_notification(
                result.get("notification", {}),
                dry_run=True,
            )
            return result
        result["status"] = "requires_review"
        result["requires_review_reason"] = "drive_workbook_ids_missing"
        result["missing_drive_keys"] = missing_drive_keys
        result["notification_delivery"] = {
            "status": "not_attempted",
            "reason": "drive_workbook_ids_missing",
        }
        result["drive_updates"] = []
        return result

    updates = []
    for key, write_key in (("ingresos", "ingresos_write"), ("forecast", "forecast_write")):
        write_result = result.get(write_key, {})
        output_path = write_result.get("output_path")
        file_id = drive_file_ids.get(key) if isinstance(drive_file_ids, dict) else None
        if output_path and file_id:
            updates.append(
                replace_document_content(
                    {
                        "dry_run": dry_run,
                        "drive_file_id": file_id,
                        "source_path": output_path,
                    }
                )
            )
    result["drive_updates"] = updates
    failed_updates = [
        update
        for update in updates
        if update.get("status") not in ("ready_for_update", "updated")
    ]
    if failed_updates:
        result["status"] = "requires_review"
        result["requires_review_reason"] = "drive_workbook_update_failed"
        result["failed_drive_updates"] = failed_updates
        result["notification_delivery"] = {
            "status": "not_attempted",
            "reason": "drive_workbook_update_failed",
        }
        return result

    # Skip notifications when status is requires_review (Drive was still uploaded).
    if is_requires_review:
        result["notification_delivery"] = {
            "status": "not_attempted",
            "reason": "stage_requires_review",
        }
        return result

    result["notification_delivery"] = send_notification(
        result.get("notification", {}),
        dry_run=dry_run,
    )
    if result["notification_delivery"].get("status") == "requires_review":
        result["status"] = "requires_review"
        result["requires_review_reason"] = result["notification_delivery"].get("review_reason")
    return result


def run_initial_stage(request: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    script = _load("script")
    writer = _load("workbook_writer")
    pipeline = _load("two_stage_pipeline")
    workflow_result = script.run(request, config)
    payload = request.get("payload", {})
    paths = payload.get("workbook_paths", {})
    outputs = payload.get("workbook_outputs", {})
    dry_run = bool(request.get("dry_run", True))
    channels = _income_channels(payload, workflow_result)
    cell_notes = _income_cell_notes(payload, workflow_result)
    if workflow_result.get("status") not in ("ready_for_approval", "requires_review"):
        return pipeline.initial_stage_result(
            workflow_result,
            {"status": "requires_review", "review_reason": "reconciliation_not_ready"},
            {"status": "requires_review", "review_reason": "reconciliation_not_ready"},
            config.get("supervisor_email"),
        )

    ingresos = writer.write_ingresos(
        str(paths.get("ingresos", "")),
        str(outputs.get("ingresos", "")),
        str(payload.get("business_date", "")),
        channels,
        stage="corte_loaded",
        dry_run=dry_run,
        layout=config.get("ingresos_layout"),
        cell_notes=cell_notes,
    )
    revision_document = workflow_result.get("workflow_run", {}).get("revision_document")
    if not isinstance(revision_document, dict):
        return pipeline.initial_stage_result(
            workflow_result,
            {"status": "requires_review", "review_reason": "revision_document_missing"},
            {"status": "requires_review", "review_reason": "revision_document_missing"},
            config.get("supervisor_email"),
        )
    from workflows.corte_santo.daily_record import spreadsheet_totals

    canonical_evidence = workflow_result.get("workflow_run", {}).get("canonical_evidence", {})
    income_register = canonical_evidence.get("income_register") or payload.get("income_register") or {}
    daily_totals = spreadsheet_totals(income_register)
    venta_bruta = daily_totals["venta_bruta"]
    revision_document["daily_financial_record"] = {
        "venta_bruta": venta_bruta,
        "total_bruto": daily_totals["total_bruto"],
        "parser_version": "corte_daily_record_v1",
    }
    forecast = writer.write_forecast(
        str(paths.get("forecast", "")),
        str(outputs.get("forecast", "")),
        str(payload.get("business_date", "")),
        venta_bruta or 0,
        dry_run=dry_run,
        layout=config.get("forecast_layout"),
    )
    result = pipeline.initial_stage_result(
        workflow_result,
        ingresos,
        forecast,
        config.get("supervisor_email"),
    )
    # Propagate expected_collections to top level for bank watcher
    result["expected_collections"] = (
        workflow_result.get("workflow_run", {}).get("expected_collections", [])
    )
    return _deliver_and_update(
        result,
        payload,
        dry_run,
        required_drive_keys=("ingresos", "forecast"),
    )


def run_bank_stage(request: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    bank_parser = _load("bank_statement_parser")
    bank_reconciliation = _load("bank_reconciliation")
    writer = _load("workbook_writer")
    pipeline = _load("two_stage_pipeline")
    payload = request.get("payload", {})
    docs = payload.get("documents", [])
    by_type = {
        doc.get("document_type"): doc
        for doc in docs
        if isinstance(doc, dict) and doc.get("document_type")
    }
    banorte_doc = by_type.get("banorte_statement", {})
    amex_doc = by_type.get("amex_statement", {})
    banorte = bank_parser.parse_banorte_csv(str(banorte_doc.get("source_path", "")), config)
    amex = bank_reconciliation.parse_amex_xls(str(amex_doc.get("source_path", "")))
    income_channels = _bank_write_channels(payload)
    layout_columns = (config.get("ingresos_layout") or {}).get("columns", {})
    for key in layout_columns:
        if income_channels.get(key) is None:
            income_channels[key] = 0.0
    bank_result = bank_reconciliation.reconcile_bank_stage(
        payload.get("expected_collections", []),
        banorte,
        amex,
        tolerance=float(config.get("thresholds", {}).get("reconciliation_tolerance", 0)),
    )

    paths = payload.get("workbook_paths", {})
    outputs = payload.get("workbook_outputs", {})
    if bank_result.get("status") == "bank_validated":
        ingresos_blue = writer.write_ingresos(
            str(paths.get("ingresos", "")),
            str(outputs.get("ingresos", "")),
            str(payload.get("business_date", "")),
            income_channels,
            stage="bank_validated",
            dry_run=bool(request.get("dry_run", True)),
            layout=config.get("ingresos_layout"),
            cell_notes=payload.get("income_cell_notes") if isinstance(payload.get("income_cell_notes"), dict) else None,
        )
    else:
        ingresos_blue = {
            "status": "requires_review",
            "review_reason": "bank_reconciliation_not_ready",
        }
    revision = dict(payload.get("revision_document", {}))
    revision["falta_por_entrar"] = bank_result.get("pending_collections", {})
    revision["gastos_adicionales"] = bank_result.get("additional_expenses", [])
    revision["bank_validation_status"] = bank_result.get("status")
    result = pipeline.bank_stage_result(
        bank_result,
        ingresos_blue,
        revision,
        config.get("supervisor_email"),
    )
    return _deliver_and_update(
        result,
        payload,
        bool(request.get("dry_run", True)),
        required_drive_keys=("ingresos",),
    )
