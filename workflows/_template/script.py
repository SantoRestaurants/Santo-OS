from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REQUIRED_CONFIG_KEYS = ("workflow_key", "owner_role", "review_policy")


def _json_dumps(data: dict[str, Any]) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _stable_hash(data: dict[str, Any]) -> str:
    return hashlib.sha256(_json_dumps(data).encode("utf-8")).hexdigest()


def _load_json(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    with Path(path).open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    if not isinstance(loaded, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return loaded


def _missing_config(config: dict[str, Any]) -> list[str]:
    missing = []
    for key in REQUIRED_CONFIG_KEYS:
        value = config.get(key)
        if value in (None, "", "[CONFIRM]"):
            missing.append(key)

    review_policy = config.get("review_policy")
    if not isinstance(review_policy, dict):
        missing.append("review_policy.default_reviewer_role")
    elif review_policy.get("default_reviewer_role") in (None, "", "[CONFIRM]"):
        missing.append("review_policy.default_reviewer_role")

    return sorted(set(missing))


def run(input_payload: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = config or {}
    dry_run = bool(input_payload.get("dry_run", True))
    workflow_key = input_payload.get("workflow_key") or config.get("workflow_key") or "unknown_workflow"
    now = datetime.now(UTC).isoformat()
    missing = _missing_config(config)
    idempotency_key = _stable_hash(
        {
            "workflow_key": workflow_key,
            "phase": input_payload.get("phase", "P0"),
            "trigger": input_payload.get("trigger", {}),
            "payload": input_payload.get("payload", {}),
        }
    )

    logging.info("workflow_start workflow_key=%s dry_run=%s", workflow_key, dry_run)

    if missing:
        status = "requires_review"
        result = {
            "status": status,
            "workflow_key": workflow_key,
            "dry_run": dry_run,
            "idempotency_key": idempotency_key,
            "started_at": now,
            "finished_at": now,
            "exceptions": [
                {
                    "type": "missing_config",
                    "severity": "medium",
                    "message": "Workflow config is missing required confirmed values.",
                    "missing_keys": missing,
                }
            ],
            "events": [
                {
                    "type": "workflow.requires_review",
                    "message": "Missing config prevented workflow completion.",
                }
            ],
        }
        logging.info("workflow_end workflow_key=%s status=%s", workflow_key, status)
        return result

    status = "dry_run_completed" if dry_run else "ready_for_dispatch"
    result = {
        "status": status,
        "workflow_key": workflow_key,
        "dry_run": dry_run,
        "idempotency_key": idempotency_key,
        "started_at": now,
        "finished_at": now,
        "exceptions": [],
        "events": [
            {
                "type": f"workflow.{status}",
                "message": "Template workflow contract completed.",
            }
        ],
    }
    logging.info("workflow_end workflow_key=%s status=%s", workflow_key, status)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a SantoOS workflow template module.")
    parser.add_argument("--input", required=True, help="Path to structured workflow input JSON.")
    parser.add_argument("--config", help="Path to workflow config JSON.")
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
        logging.exception("workflow_failure")
        return 1


if __name__ == "__main__":
    sys.exit(main())
