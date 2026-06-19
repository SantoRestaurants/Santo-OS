from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REQUIRES_REVIEW = "requires_review"


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


def _normalize_addresses(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, str):
        return [value]

    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]

    return []


def _email_idempotency_key(email: dict[str, Any]) -> str:
    return _stable_hash(
        {
            "provider": email.get("provider", "gmail"),
            "provider_message_id": email.get("provider_message_id"),
            "internet_message_id": email.get("internet_message_id"),
        }
    )


def _canonical_subject(subject: str) -> str:
    forward_reply_prefixes = ("RE:", "REï¼š", "FWD:", "FWDï¼š", "R:", "ENC:", "RV:", "RES:")
    raw = subject.strip()
    while raw:
        normalized = raw.upper()
        matched = False
        for prefix in forward_reply_prefixes:
            if normalized.startswith(prefix):
                raw = raw[len(prefix):].strip().lstrip("-").strip()
                matched = True
                break
        if not matched:
            break
    return " ".join(raw.upper().split())


def message_content_fingerprint(email: dict[str, Any]) -> str:
    """Stable duplicate guard for forwarded/original copies of the same intake package."""
    attachments = email.get("attachments", [])
    normalized_attachments = []
    if isinstance(attachments, list):
        for attachment in attachments:
            if not isinstance(attachment, dict):
                continue
            normalized_attachments.append(
                {
                    "filename": str(attachment.get("filename", "")).strip().lower(),
                    "size": attachment.get("size"),
                    "content_type": str(attachment.get("content_type", "")).strip().lower(),
                }
            )
    normalized_attachments = sorted(
        normalized_attachments,
        key=lambda item: (
            str(item.get("filename", "")),
            str(item.get("size", "")),
            str(item.get("content_type", "")),
        ),
    )
    return _stable_hash(
        {
            "inbox_address": str(email.get("inbox_address", "")).strip().lower(),
            "subject": _canonical_subject(str(email.get("subject") or "")),
            "attachments": normalized_attachments,
        }
    )


def _event(event_type: str, severity: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "aggregate_type": "email_message",
        "aggregate_id": None,
        "event_type": event_type,
        "severity": severity,
        "payload": payload,
        "created_at": _now(),
    }


def _base_email_message(email: dict[str, Any], processing_status: str) -> dict[str, Any]:
    return {
        "provider": email.get("provider", "gmail"),
        "provider_message_id": email.get("provider_message_id"),
        "internet_message_id": email.get("internet_message_id"),
        "inbox_address": email.get("inbox_address", "[CONFIRM]"),
        "from_address": email.get("from_address", "[CONFIRM]"),
        "to_addresses": _normalize_addresses(email.get("to_addresses")),
        "cc_addresses": _normalize_addresses(email.get("cc_addresses")),
        "subject": email.get("subject"),
        "received_at": email.get("received_at") or _now(),
        "processing_status": processing_status,
        "classification_key": None,
        "workflow_run_id": None,
        "requires_review_reason": None,
        "raw_metadata": {
            "idempotency_key": _email_idempotency_key(email),
            "message_content_fingerprint": message_content_fingerprint(email),
            "attachments": email.get("attachments", []),
            "labels": email.get("labels", []),
        },
    }


def _matching_prefixes(subject: str, prefix_map: dict[str, str]) -> list[tuple[str, str]]:
    _EMAIL_PREFIXES = ("RE:", "RE：", "FWD:", "FWD：", "R:", "ENC:", "RV:", "RES:")
    raw = subject.strip()
    normalized = raw.upper()
    for pfx in _EMAIL_PREFIXES:
        if normalized.startswith(pfx):
            after = raw[len(pfx):].strip().lstrip("-").strip()
            normalized = after.upper()
            break
    matches = []

    for prefix, workflow_key in prefix_map.items():
        if normalized.startswith(prefix.upper()):
            matches.append((prefix, workflow_key))

    return matches


def intake_email(email: dict[str, Any], routing_config: dict[str, Any] | None = None) -> dict[str, Any]:
    routing_config = routing_config or {}
    subject = str(email.get("subject") or "")

    if _has_unconfirmed_value(routing_config) or not routing_config.get("confirmed"):
        record = _base_email_message(email, REQUIRES_REVIEW)
        record["requires_review_reason"] = "missing_or_unconfirmed_routing_config"
        return {
            "status": REQUIRES_REVIEW,
            "email_message": record,
            "command": None,
            "events": [
                _event("agent_mail.received", "info", {"subject": subject}),
                _event(
                    "agent_mail.requires_review",
                    "warning",
                    {"reason": "missing_or_unconfirmed_routing_config"},
                ),
            ],
        }

    # Sender allowlist check — only process emails from known senders
    allowed_senders = routing_config.get("allowed_senders", [])
    if allowed_senders:
        from_address = str(email.get("from_address", "")).strip().lower()
        sender_allowed = any(
            from_address == sender.strip().lower()
            for sender in allowed_senders
        )
        if not sender_allowed:
            record = _base_email_message(email, REQUIRES_REVIEW)
            record["requires_review_reason"] = "sender_not_in_allowlist"
            return {
                "status": REQUIRES_REVIEW,
                "email_message": record,
                "command": None,
                "events": [
                    _event("agent_mail.received", "info", {"subject": subject}),
                    _event(
                        "agent_mail.requires_review",
                        "warning",
                        {"reason": "sender_not_in_allowlist", "from": from_address},
                    ),
                ],
            }

    ignored_prefixes = routing_config.get("ignored_subject_prefixes", [])
    for ignored_prefix in ignored_prefixes:
        if subject.strip().upper().startswith(str(ignored_prefix).upper()):
            record = _base_email_message(email, "ignored")
            record["classification_key"] = str(ignored_prefix)
            return {
                "status": "ignored",
                "email_message": record,
                "command": None,
                "events": [
                    _event("agent_mail.received", "info", {"subject": subject}),
                    _event("agent_mail.ignored", "info", {"prefix": ignored_prefix}),
                ],
            }

    prefix_map = routing_config.get("subject_prefixes", {})
    if not isinstance(prefix_map, dict) or not prefix_map:
        record = _base_email_message(email, REQUIRES_REVIEW)
        record["requires_review_reason"] = "missing_subject_prefix_rules"
        return {
            "status": REQUIRES_REVIEW,
            "email_message": record,
            "command": None,
            "events": [
                _event("agent_mail.received", "info", {"subject": subject}),
                _event(
                    "agent_mail.requires_review",
                    "warning",
                    {"reason": "missing_subject_prefix_rules"},
                ),
            ],
        }

    matches = _matching_prefixes(subject, prefix_map)

    if len(matches) != 1:
        reason = "ambiguous_routing" if matches else "unclassified_email"
        record = _base_email_message(email, REQUIRES_REVIEW)
        record["requires_review_reason"] = reason
        return {
            "status": REQUIRES_REVIEW,
            "email_message": record,
            "command": None,
            "events": [
                _event("agent_mail.received", "info", {"subject": subject}),
                _event("agent_mail.requires_review", "warning", {"reason": reason}),
            ],
        }

    prefix, workflow_key = matches[0]
    record = _base_email_message(email, "classified")
    record["classification_key"] = prefix
    record["raw_metadata"]["workflow_key"] = workflow_key

    command = {
        "command_type": "workflow.intake",
        "phase": "P0",
        "source_channel": "agent_mail",
        "workflow_key": workflow_key,
        "dry_run": bool(routing_config.get("dry_run", True)),
        "actor": {
            "id": "agent_mail",
            "role": routing_config.get("default_actor_role", "agent_mail_intake"),
        },
        "payload": {
            "email_provider": record["provider"],
            "provider_message_id": record["provider_message_id"],
            "classification_key": prefix,
            "attachments": record["raw_metadata"]["attachments"],
        },
    }

    return {
        "status": "classified",
        "email_message": record,
        "command": command,
        "events": [
            _event("agent_mail.received", "info", {"subject": subject}),
            _event(
                "agent_mail.classified",
                "info",
                {"prefix": prefix, "workflow_key": workflow_key},
            ),
        ],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Classify a SantoOS Agent Mail message.")
    parser.add_argument("--email", required=True, help="Path to structured email JSON.")
    parser.add_argument("--routing", help="Path to routing config JSON.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        email = _load_json(args.email)
        routing = _load_json(args.routing)
        print(json.dumps(intake_email(email, routing), indent=2, sort_keys=True))
        return 0
    except Exception:
        logging.exception("agent_mail_intake_failure")
        return 1


if __name__ == "__main__":
    sys.exit(main())
