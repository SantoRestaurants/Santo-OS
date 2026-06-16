"""Two-stage Corte Santo orchestration contract."""

from __future__ import annotations

from typing import Any


def notification(to: str | None, subject: str, text: str, *, kind: str) -> dict[str, Any]:
    return {
        "status": "ready_to_send" if to else "requires_review",
        "review_reason": None if to else "supervisor_email_missing",
        "to": to,
        "subject": subject,
        "text": text,
        "kind": kind,
    }


def initial_stage_result(
    workflow_result: dict[str, Any],
    ingresos_result: dict[str, Any],
    forecast_result: dict[str, Any],
    supervisor_email: str | None,
) -> dict[str, Any]:
    ready = (
        workflow_result.get("status") == "ready_for_approval"
        and ingresos_result.get("status") in ("planned", "written")
        and forecast_result.get("status") in ("planned", "written")
    )
    status = "waiting_for_input" if ready else "requires_review"
    business_date = workflow_result.get("workflow_run", {}).get("business_date")
    return {
        "status": status,
        "stage": "corte_loaded",
        "requires_review_reason": None if ready else "initial_stage_requires_review",
        "waiting_reason": "awaiting_bank_files" if ready else None,
        "workflow_result": workflow_result,
        "ingresos_write": ingresos_result,
        "forecast_write": forecast_result,
        "required_bank_documents": ["amex_statement", "banorte_statement"],
        "next_trigger": "drive_bank_watcher",
        "notification": notification(
            supervisor_email,
            f"[CORTE CARGADO] SANTO {business_date}",
            "El corte fue conciliado y cargado. Subí los estados AMEX y Banorte a Drive para iniciar la validación bancaria.",
            kind="corte_loaded",
        ),
    }


def bank_stage_result(
    bank_reconciliation: dict[str, Any],
    ingresos_blue_result: dict[str, Any],
    revision_document: dict[str, Any],
    supervisor_email: str | None,
) -> dict[str, Any]:
    ready = (
        bank_reconciliation.get("status") == "bank_validated"
        and ingresos_blue_result.get("status") in ("planned", "written")
    )
    return {
        "status": "completed" if ready else "requires_review",
        "stage": "bank_validated" if ready else "bank_requires_review",
        "bank_reconciliation": bank_reconciliation,
        "ingresos_write": ingresos_blue_result,
        "revision_document": revision_document,
        "notification": notification(
            supervisor_email,
            "[CORTE VALIDADO CONTRA BANCO] SANTO",
            "Los estados AMEX y Banorte fueron cruzados. El Excel quedó marcado en azul y REVISION fue actualizado.",
            kind="bank_validated",
        ),
    }
