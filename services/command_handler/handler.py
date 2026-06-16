from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

ALLOWED_PHASES = {"P0"}
ALLOWED_CHANNELS = {"dashboard", "agent_mail", "scheduler", "whatsapp_stub", "system"}
ALLOWED_COMMAND_TYPES = {"workflow.run", "workflow.intake", "workflow.resume", "workflow.status"}
REQUIRES_REVIEW = "requires_review"


class WorkflowRegistry(Protocol):
    def get_workflow(self, workflow_key: str) -> dict[str, Any] | None:
        """Return a workflow registry record by key."""


@dataclass(frozen=True)
class InMemoryWorkflowRegistry:
    workflows: dict[str, dict[str, Any]]

    def get_workflow(self, workflow_key: str) -> dict[str, Any] | None:
        return self.workflows.get(workflow_key)


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


def _event(event_type: str, severity: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "aggregate_type": "command",
        "aggregate_id": None,
        "event_type": event_type,
        "severity": severity,
        "payload": payload,
        "created_at": _now(),
    }


def _watchdog(check_key: str, status: str, severity: str, message: str) -> dict[str, Any]:
    return {
        "check_key": check_key,
        "status": status,
        "severity": severity,
        "message": message,
        "metadata": {},
        "checked_at": _now(),
    }


def _review_result(
    *,
    command: dict[str, Any],
    idempotency_key: str,
    reason: str,
    missing: list[str] | None = None,
) -> dict[str, Any]:
    payload = {
        "command_type": command.get("command_type"),
        "workflow_key": command.get("workflow_key"),
        "source_channel": command.get("source_channel"),
        "reason": reason,
        "missing": missing or [],
    }

    return {
        "status": REQUIRES_REVIEW,
        "workflow_run_status": REQUIRES_REVIEW,
        "dry_run": bool(command.get("dry_run", True)),
        "idempotency_key": idempotency_key,
        "reason": reason,
        "missing": missing or [],
        "events": [
            _event("command.received", "info", payload),
            _event("command.requires_review", "warning", payload),
        ],
        "watchdog_log": [
            _watchdog(
                "command_handler.validation",
                REQUIRES_REVIEW,
                "warning",
                f"Command requires review: {reason}",
            )
        ],
    }


def _command_idempotency_key(command: dict[str, Any]) -> str:
    return _stable_hash(
        {
            "command_type": command.get("command_type"),
            "phase": command.get("phase", "P0"),
            "source_channel": command.get("source_channel"),
            "workflow_key": command.get("workflow_key"),
            "actor_id": (command.get("actor") or {}).get("id"),
            "payload": command.get("payload", {}),
        }
    )


def handle_command(
    command: dict[str, Any],
    registry: WorkflowRegistry | None = None,
) -> dict[str, Any]:
    """Validate and prepare a shared SantoOS command.

    The command handler is the shared entry point for dashboard, Agent Mail,
    scheduler and future WhatsApp. It intentionally returns records to persist
    rather than writing directly until the Supabase adapter is wired.
    """

    idempotency_key = command.get("idempotency_key") or _command_idempotency_key(command)
    command_type = command.get("command_type")
    phase = command.get("phase", "P0")
    source_channel = command.get("source_channel")
    workflow_key = command.get("workflow_key")
    actor = command.get("actor") if isinstance(command.get("actor"), dict) else {}
    actor_role = actor.get("role")

    logging.info(
        "command_received command_type=%s workflow_key=%s source_channel=%s",
        command_type,
        workflow_key,
        source_channel,
    )

    if phase not in ALLOWED_PHASES:
        return _review_result(
            command=command,
            idempotency_key=idempotency_key,
            reason="unsupported_phase",
            missing=["phase:P0"],
        )

    if command_type not in ALLOWED_COMMAND_TYPES:
        return _review_result(
            command=command,
            idempotency_key=idempotency_key,
            reason="unsupported_command_type",
            missing=["command_type"],
        )

    if source_channel not in ALLOWED_CHANNELS:
        return _review_result(
            command=command,
            idempotency_key=idempotency_key,
            reason="unsupported_source_channel",
            missing=["source_channel"],
        )

    if not workflow_key:
        return _review_result(
            command=command,
            idempotency_key=idempotency_key,
            reason="missing_workflow_key",
            missing=["workflow_key"],
        )

    if not actor_role or _has_unconfirmed_value(actor_role):
        return _review_result(
            command=command,
            idempotency_key=idempotency_key,
            reason="missing_actor_role",
            missing=["actor.role"],
        )

    if registry is None:
        return _review_result(
            command=command,
            idempotency_key=idempotency_key,
            reason="missing_workflow_registry",
            missing=["workflow_registry"],
        )

    workflow = registry.get_workflow(workflow_key)

    if workflow is None:
        return _review_result(
            command=command,
            idempotency_key=idempotency_key,
            reason="unknown_workflow",
            missing=["workflows.workflow_key"],
        )

    if workflow.get("confirmation_status") != "confirmed" or _has_unconfirmed_value(
        workflow.get("default_config", {})
    ):
        return _review_result(
            command=command,
            idempotency_key=idempotency_key,
            reason="workflow_config_requires_review",
            missing=["workflows.default_config"],
        )

    dry_run = bool(command.get("dry_run", True))
    payload = {
        "command_type": command_type,
        "workflow_key": workflow_key,
        "source_channel": source_channel,
        "dry_run": dry_run,
    }
    status = "accepted"

    result = {
        "status": status,
        "workflow_run_status": "queued",
        "dry_run": dry_run,
        "idempotency_key": idempotency_key,
        "workflow": {
            "workflow_key": workflow_key,
            "display_name": workflow.get("display_name"),
        },
        "events": [
            _event("command.received", "info", payload),
            _event("command.accepted", "info", payload),
        ],
        "watchdog_log": [
            _watchdog(
                "command_handler.validation",
                "ok",
                "info",
                "Command accepted for registry-backed dispatch.",
            )
        ],
    }

    logging.info(
        "command_finished command_type=%s workflow_key=%s status=%s",
        command_type,
        workflow_key,
        status,
    )

    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate a SantoOS command envelope.")
    parser.add_argument("--input", required=True, help="Path to command JSON.")
    parser.add_argument("--registry", help="Path to workflow registry JSON keyed by workflow_key.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        command = _load_json(args.input)
        registry_data = _load_json(args.registry)
        registry = InMemoryWorkflowRegistry(registry_data) if registry_data else None
        print(json.dumps(handle_command(command, registry), indent=2, sort_keys=True))
        return 0
    except Exception:
        logging.exception("command_handler_failure")
        return 1


if __name__ == "__main__":
    sys.exit(main())
