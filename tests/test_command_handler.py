from __future__ import annotations

from services.command_handler.handler import InMemoryWorkflowRegistry, handle_command


BASE_COMMAND = {
    "command_type": "workflow.run",
    "phase": "P0",
    "source_channel": "dashboard",
    "workflow_key": "corte_santo_daily_sales_reconciliation",
    "dry_run": True,
    "actor": {"id": "local_dev", "role": "admin_ops"},
    "payload": {"business_date": "2026-05-27"},
}

CONFIRMED_REGISTRY = InMemoryWorkflowRegistry(
    {
        "corte_santo_daily_sales_reconciliation": {
            "workflow_key": "corte_santo_daily_sales_reconciliation",
            "display_name": "Corte Santo - Daily Sales Reconciliation",
            "confirmation_status": "confirmed",
            "default_config": {
                "thresholds": {"cash_difference_medium": 0},
                "reviewer_map": {"default": "admin_ops"},
            },
        }
    }
)

PENDING_REGISTRY = InMemoryWorkflowRegistry(
    {
        "corte_santo_daily_sales_reconciliation": {
            "workflow_key": "corte_santo_daily_sales_reconciliation",
            "display_name": "Corte Santo - Daily Sales Reconciliation",
            "confirmation_status": "requires_review",
            "default_config": {"thresholds": "[CONFIRM]"},
        }
    }
)


def test_missing_registry_requires_review() -> None:
    result = handle_command(BASE_COMMAND)

    assert result["status"] == "requires_review"
    assert result["reason"] == "missing_workflow_registry"
    assert result["watchdog_log"][0]["status"] == "requires_review"


def test_pending_workflow_config_requires_review() -> None:
    result = handle_command(BASE_COMMAND, PENDING_REGISTRY)

    assert result["status"] == "requires_review"
    assert result["reason"] == "workflow_config_requires_review"
    assert "command.requires_review" in {event["event_type"] for event in result["events"]}


def test_missing_actor_role_requires_review() -> None:
    command = {**BASE_COMMAND, "actor": {"id": "local_dev"}}
    result = handle_command(command, CONFIRMED_REGISTRY)

    assert result["status"] == "requires_review"
    assert result["reason"] == "missing_actor_role"


def test_unsupported_phase_requires_review() -> None:
    command = {**BASE_COMMAND, "phase": "P1"}
    result = handle_command(command, CONFIRMED_REGISTRY)

    assert result["status"] == "requires_review"
    assert result["reason"] == "unsupported_phase"


def test_confirmed_workflow_is_accepted_for_dispatch() -> None:
    result = handle_command(BASE_COMMAND, CONFIRMED_REGISTRY)

    assert result["status"] == "accepted"
    assert result["workflow_run_status"] == "queued"
    assert result["watchdog_log"][0]["status"] == "ok"
    assert "command.accepted" in {event["event_type"] for event in result["events"]}


def test_idempotency_key_is_stable() -> None:
    first = handle_command(BASE_COMMAND, CONFIRMED_REGISTRY)
    second = handle_command(BASE_COMMAND, CONFIRMED_REGISTRY)

    assert first["idempotency_key"] == second["idempotency_key"]
