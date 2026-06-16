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
        "amex": register.get("amex"),
        "debito": register.get("debito"),
        "credito": register.get("credito"),
        "efectivo": register.get("efectivo"),
        "paypal": register.get("paypal"),
        "uber": register.get("uber"),
        "rappi": register.get("rappi"),
        "propinas": register.get("propinas"),
    }


def _deliver_and_update(
    result: dict[str, Any],
    payload: dict[str, Any],
    dry_run: bool,
    *,
    required_drive_keys: tuple[str, ...],
) -> dict[str, Any]:
    if result.get("status") not in ("waiting_for_input", "completed"):
        result["notification_delivery"] = {
            "status": "not_attempted",
            "reason": "workflow_stage_requires_review",
        }
        result["drive_updates"] = []
        return result

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
    if workflow_result.get("status") != "ready_for_approval":
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
    )
    venta_bruta = workflow_result.get("workflow_run", {}).get("revision_document", {}).get(
        "reconciliation_totals", {}
    ).get("total_real")
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
    income_channels = payload.get("income_channels", {})
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
