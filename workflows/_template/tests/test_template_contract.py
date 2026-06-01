from __future__ import annotations

import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "script.py"
SPEC = importlib.util.spec_from_file_location("workflow_template_script", MODULE_PATH)
assert SPEC is not None
assert SPEC.loader is not None
workflow_template_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(workflow_template_script)


def test_missing_config_requires_review() -> None:
    result = workflow_template_script.run(
        {
            "workflow_key": "template_workflow",
            "phase": "P0",
            "dry_run": True,
            "payload": {"example": True},
        },
        {},
    )

    assert result["status"] == "requires_review"
    assert result["exceptions"][0]["type"] == "missing_config"


def test_idempotency_key_is_stable_for_same_input() -> None:
    payload = {
        "workflow_key": "template_workflow",
        "phase": "P0",
        "dry_run": True,
        "trigger": {"channel": "dashboard"},
        "payload": {"example": True},
    }
    config = {
        "workflow_key": "template_workflow",
        "owner_role": "admin_ops",
        "review_policy": {"default_reviewer_role": "admin_ops"},
    }

    first = workflow_template_script.run(payload, config)
    second = workflow_template_script.run(payload, config)

    assert first["idempotency_key"] == second["idempotency_key"]
    assert first["status"] == "dry_run_completed"
