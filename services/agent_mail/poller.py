"""
AgentMail Poller — polls santoos@agentmail.to for new messages,
classifies them using the existing intake logic, and writes results to Supabase.

Usage:
    python -m services.agent_mail.poller --config services/agent_mail/config.json

Environment variables:
    AGENTMAIL_API_KEY     — API key for AgentMail
    AGENTMAIL_INBOX_ID   — Inbox ID (default: santoos@agentmail.to)
    SUPABASE_URL         — Supabase project URL
    SUPABASE_SERVICE_KEY  — Supabase service role key (for writes)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from services.agent_mail.intake import intake_email

logger = logging.getLogger("agent_mail.poller")

DEFAULT_INBOX_ID = "santoos@agentmail.to"
AGENTMAIL_BASE = "https://api.agentmail.to/v0"


def _load_config(path: str | None) -> dict[str, Any]:
    if not path:
        return {}
    with Path(path).open("r", encoding="utf-8") as f:
        return json.load(f)


def _env(name: str, default: str = "") -> str:
    import os
    return os.environ.get(name, default)


class AgentMailClient:
    """Thin HTTP client for AgentMail API."""

    def __init__(self, api_key: str, inbox_id: str = DEFAULT_INBOX_ID):
        self.api_key = api_key
        self.inbox_id = inbox_id
        self.http = httpx.Client(
            base_url=AGENTMAIL_BASE,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30.0,
        )

    def list_messages(self, after: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"limit": limit}
        if after:
            params["after"] = after
        resp = self.http.get(f"/inboxes/{self.inbox_id}/messages", params=params)
        resp.raise_for_status()
        return resp.json().get("messages", [])

    def get_message(self, message_id: str) -> dict[str, Any]:
        resp = self.http.get(f"/inboxes/{self.inbox_id}/messages/{message_id}")
        resp.raise_for_status()
        return resp.json()


class SupabaseWriter:
    """Writes classified email records to Supabase."""

    def __init__(self, url: str, service_key: str):
        self.http = httpx.Client(
            base_url=url,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            },
            timeout=30.0,
        )

    def upsert_email_message(self, record: dict[str, Any]) -> bool:
        """Upsert into email_messages. Returns True on success."""
        resp = self.http.post("/rest/v1/email_messages", json=record)
        if resp.status_code >= 400:
            logger.error("Failed to write email_message: %s %s", resp.status_code, resp.text)
            return False
        return True

    def insert_event(self, event: dict[str, Any]) -> bool:
        resp = self.http.post("/rest/v1/events", json=event)
        if resp.status_code >= 400:
            logger.error("Failed to write event: %s %s", resp.status_code, resp.text)
            return False
        return True


def _agentmail_to_intake_format(msg: dict[str, Any]) -> dict[str, Any]:
    """Convert AgentMail message format to our intake format."""
    from_field = msg.get("from", "")
    # Extract email from "Display Name <email>" format
    from_email = from_field
    if "<" in from_field and ">" in from_field:
        from_email = from_field.split("<")[1].rstrip(">")

    to_addresses = []
    for addr in msg.get("to", []):
        if "<" in addr and ">" in addr:
            to_addresses.append(addr.split("<")[1].rstrip(">"))
        else:
            to_addresses.append(addr)

    cc_addresses = []
    for addr in msg.get("cc", []) or []:
        if "<" in addr and ">" in addr:
            cc_addresses.append(addr.split("<")[1].rstrip(">"))
        else:
            cc_addresses.append(addr)

    attachments = []
    for att in msg.get("attachments", []) or []:
        attachments.append({
            "filename": att.get("filename", "unknown"),
            "content_type": att.get("content_type", "application/octet-stream"),
            "size": att.get("size"),
            "attachment_id": att.get("attachment_id"),
        })

    return {
        "provider": "agentmail",
        "provider_message_id": msg.get("message_id", ""),
        "internet_message_id": msg.get("message_id"),
        "inbox_address": msg.get("inbox_id", DEFAULT_INBOX_ID),
        "from_address": from_email,
        "to_addresses": to_addresses,
        "cc_addresses": cc_addresses,
        "subject": msg.get("subject"),
        "received_at": msg.get("timestamp"),
        "attachments": attachments,
        "labels": msg.get("labels", []),
    }


def poll_and_classify(
    client: AgentMailClient,
    routing_config: dict[str, Any],
    supabase: SupabaseWriter | None = None,
    after: str | None = None,
    dry_run: bool = True,
) -> list[dict[str, Any]]:
    """
    Poll new messages, classify them, optionally write to Supabase.
    Returns list of classification results.
    """
    messages = client.list_messages(after=after)
    results = []

    for msg in messages:
        intake_input = _agentmail_to_intake_format(msg)
        result = intake_email(intake_input, routing_config)

        result["_source_message_id"] = msg.get("message_id")
        result["_source_subject"] = msg.get("subject")
        result["_source_from"] = msg.get("from")
        results.append(result)

        logger.info(
            "Classified: subject=%r status=%s",
            msg.get("subject"),
            result["status"],
        )

        if supabase and not dry_run:
            email_record = result["email_message"]
            # Clean up for Supabase insert
            supabase_record = {
                "provider": email_record["provider"],
                "provider_message_id": email_record["provider_message_id"],
                "internet_message_id": email_record.get("internet_message_id"),
                "inbox_address": email_record["inbox_address"],
                "from_address": email_record["from_address"],
                "to_addresses": email_record["to_addresses"],
                "cc_addresses": email_record["cc_addresses"],
                "subject": email_record["subject"],
                "received_at": email_record["received_at"],
                "processing_status": email_record["processing_status"],
                "classification_key": email_record.get("classification_key"),
                "requires_review_reason": email_record.get("requires_review_reason"),
                "raw_metadata": email_record.get("raw_metadata", {}),
            }
            supabase.upsert_email_message(supabase_record)

            for event in result.get("events", []):
                supabase.insert_event(event)

    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Poll AgentMail inbox and classify messages.")
    parser.add_argument("--config", help="Path to routing config JSON.")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Don't write to Supabase (default).")
    parser.add_argument("--write", action="store_true", help="Write results to Supabase.")
    parser.add_argument("--after", help="Only fetch messages after this ISO timestamp.")
    parser.add_argument("--watch", action="store_true", help="Keep polling every 30s.")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

    api_key = _env("AGENTMAIL_API_KEY")
    inbox_id = _env("AGENTMAIL_INBOX_ID", DEFAULT_INBOX_ID)

    if not api_key:
        logger.error("AGENTMAIL_API_KEY is required")
        return 1

    client = AgentMailClient(api_key=api_key, inbox_id=inbox_id)
    routing_config = _load_config(args.config)

    dry_run = not args.write
    supabase = None

    if not dry_run:
        sb_url = _env("SUPABASE_URL")
        sb_key = _env("SUPABASE_SERVICE_KEY")
        if not sb_url or not sb_key:
            logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY required for --write mode")
            return 1
        supabase = SupabaseWriter(url=sb_url, service_key=sb_key)

    if args.watch:
        logger.info("Watching inbox %s (dry_run=%s)...", inbox_id, dry_run)
        last_check = args.after
        while True:
            try:
                results = poll_and_classify(
                    client, routing_config, supabase,
                    after=last_check, dry_run=dry_run,
                )
                if results:
                    last_check = datetime.now(UTC).isoformat()
                    logger.info("Processed %d message(s)", len(results))
            except Exception:
                logger.exception("Poll cycle failed")
            time.sleep(30)
    else:
        results = poll_and_classify(
            client, routing_config, supabase,
            after=args.after, dry_run=dry_run,
        )
        print(json.dumps(results, indent=2, default=str))
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
