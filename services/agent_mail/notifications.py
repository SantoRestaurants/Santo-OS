"""Agent Mail notification boundary for workflow-generated messages."""

from __future__ import annotations

import os
from typing import Any

import httpx

AGENTMAIL_BASE = "https://api.agentmail.to/v0"


def send_notification(
    message: dict[str, Any],
    *,
    dry_run: bool = True,
    transport: httpx.BaseTransport | None = None,
) -> dict[str, Any]:
    missing = [key for key in ("to", "subject", "text") if not message.get(key)]
    if missing:
        return {"status": "requires_review", "review_reason": "missing_notification_fields", "missing": missing}
    if dry_run:
        return {"status": "ready_to_send", "message": message}

    api_key = os.environ.get("AGENTMAIL_API_KEY", "")
    inbox_id = os.environ.get("AGENTMAIL_INBOX_ID", "santoos@agentmail.to")
    if not api_key:
        return {"status": "requires_review", "review_reason": "agentmail_api_key_missing"}

    with httpx.Client(transport=transport, timeout=30.0) as client:
        response = client.post(
            f"{AGENTMAIL_BASE}/inboxes/{inbox_id}/messages/send",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"to": message["to"], "subject": message["subject"], "text": message["text"]},
        )
        response.raise_for_status()
        return {"status": "sent", "response": response.json(), "message": message}
