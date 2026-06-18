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
import hashlib
import json
import logging
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from services.agent_mail.intake import intake_email
from services.agent_mail.corte_santo_automation import run_corte_initial_from_message
from services.ai.classifier import classify_email, summarize_email
from services.drive_connector.connector import save_document

logger = logging.getLogger("agent_mail.poller")

DEFAULT_INBOX_ID = "santoos@agentmail.to"


def _safe_storage_segment(value: str, *, fallback: str = "item") -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value or "")).strip("._-")
    return normalized[:120] or fallback


def _safe_message_storage_id(message_id: str) -> str:
    digest = hashlib.sha256(str(message_id or "").encode("utf-8")).hexdigest()[:16]
    return f"msg_{digest}"
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

    def download_attachment(self, message_id: str, attachment_id: str) -> bytes:
        """Download an attachment from AgentMail API."""
        resp = self.http.get(
            f"/inboxes/{self.inbox_id}/messages/{message_id}/attachments/{attachment_id}"
        )
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            payload = resp.json()
            download_url = payload.get("download_url") if isinstance(payload, dict) else None
            if download_url:
                download_resp = httpx.get(str(download_url), timeout=60.0)
                download_resp.raise_for_status()
                return download_resp.content
        return resp.content


class SupabaseWriter:
    """Writes classified email records to Supabase."""

    def __init__(self, url: str, service_key: str):
        self.http = httpx.Client(
            base_url=url,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=representation",
            },
            timeout=30.0,
        )

    def upsert_email_message(self, record: dict[str, Any]) -> dict[str, Any] | None:
        """Upsert into email_messages. Returns the record on success."""
        resp = self.http.post(
            "/rest/v1/email_messages",
            params={"on_conflict": "provider,provider_message_id"},
            json=record,
        )
        if resp.status_code >= 400:
            logger.error("Failed to write email_message: %s %s", resp.status_code, resp.text)
            return None
        data = resp.json()
        if isinstance(data, list) and data:
            return data[0]
        return data if isinstance(data, dict) else None

    def upload_document(self, path: str, content: bytes, content_type: str) -> str | None:
        """Upload to Supabase Storage bucket 'documents' and return public URL."""
        storage_url = self.http.base_url
        upload_resp = self.http.request(
            "POST",
            f"/storage/v1/object/documents/{path}",
            content=content,
            headers={
                "Content-Type": content_type,
                "x-upsert": "true",
            },
        )
        if upload_resp.status_code >= 400:
            # Try creating the bucket first, then retry
            logger.info("Upload failed, attempting to create 'documents' bucket...")
            create_resp = self.http.post(
                "/storage/v1/bucket",
                json={"id": "documents", "name": "documents", "public": False},
            )
            if create_resp.status_code < 400 or "already exists" in create_resp.text.lower():
                upload_resp = self.http.request(
                    "POST",
                    f"/storage/v1/object/documents/{path}",
                    content=content,
                    headers={
                        "Content-Type": content_type,
                        "x-upsert": "true",
                    },
                )
            if upload_resp.status_code >= 400:
                logger.error(
                    "Failed to upload document: %s %s",
                    upload_resp.status_code,
                    upload_resp.text,
                )
                return None

        # Return the storage path as URL
        public_url = f"{storage_url}/storage/v1/object/public/documents/{path}"
        return public_url

    def insert_document(self, document: dict[str, Any]) -> str | None:
        """Insert a document record. Returns the document ID."""
        resp = self.http.post("/rest/v1/documents", json=document)
        if resp.status_code >= 400:
            logger.error("Failed to write document: %s %s", resp.status_code, resp.text)
            return None
        data = resp.json()
        if isinstance(data, list) and data:
            return data[0].get("id")
        if isinstance(data, dict):
            return data.get("id")
        return None

    def insert_event(self, event: dict[str, Any]) -> bool:
        resp = self.http.post("/rest/v1/events", json=event)
        if resp.status_code >= 400:
            logger.error("Failed to write event: %s %s", resp.status_code, resp.text)
            return False
        return True

    def insert_review(self, review: dict[str, Any]) -> bool:
        """Insert a review record (requires workflow_run_id)."""
        resp = self.http.post("/rest/v1/reviews", json=review)
        if resp.status_code >= 400:
            logger.error("Failed to write review: %s %s", resp.status_code, resp.text)
            return False
        return True

    def insert_exception(self, exception: dict[str, Any]) -> bool:
        """Insert an exception record (requires workflow_run_id)."""
        resp = self.http.post("/rest/v1/exceptions", json=exception)
        if resp.status_code >= 400:
            logger.error("Failed to write exception: %s %s", resp.status_code, resp.text)
            return False
        return True

    def get_workflow_id(self, workflow_key: str) -> str | None:
        """Get workflow UUID by key."""
        resp = self.http.get(
            "/rest/v1/workflows",
            params={"workflow_key": f"eq.{workflow_key}", "select": "id", "limit": "1"},
        )
        if resp.status_code >= 400:
            return None
        data = resp.json()
        if isinstance(data, list) and data:
            return data[0].get("id")
        return None

    def upsert_workflow_run(self, run: dict[str, Any]) -> str | None:
        """Upsert a workflow_run. Returns the run ID."""
        resp = self.http.post(
            "/rest/v1/workflow_runs",
            params={"on_conflict": "workflow_id,idempotency_key"},
            json=run,
        )
        if resp.status_code >= 400:
            logger.error("Failed to write workflow_run: %s %s", resp.status_code, resp.text)
            return None
        data = resp.json()
        if isinstance(data, list) and data:
            return data[0].get("id")
        if isinstance(data, dict):
            return data.get("id")
        return None

    def update_workflow_run_output(self, run_id: str, output: dict[str, Any], status: str | None = None) -> bool:
        """Patch a workflow_run's output_payload and optional status."""
        body: dict[str, Any] = {"output_payload": output}
        if status:
            body["status"] = status
        resp = self.http.patch(
            f"/rest/v1/workflow_runs?id=eq.{run_id}",
            json=body,
        )
        if resp.status_code >= 400:
            logger.error("Failed to update workflow_run output: %s %s", resp.status_code, resp.text)
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
    drive_config: dict[str, Any] | None = None,
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

        # AI classification for unclassified emails
        if (
            result["status"] == "requires_review"
            and result["email_message"].get("requires_review_reason") == "unclassified_email"
        ):
            subject = msg.get("subject", "")
            body = msg.get("body_text", "") or msg.get("body", "")
            prefix_map = routing_config.get("subject_prefixes", {})

            ai_result = classify_email(
                subject=subject,
                body=body,
                available_workflows=prefix_map,
            )

            if ai_result["classified"]:
                # Update the result with AI classification
                result["status"] = "classified"
                result["email_message"]["processing_status"] = "classified"
                result["email_message"]["classification_key"] = ai_result["classification_key"]
                result["email_message"]["requires_review_reason"] = None
                result["email_message"]["raw_metadata"]["workflow_key"] = ai_result["workflow_key"]
                result["email_message"]["raw_metadata"]["ai_classification"] = {
                    "confidence": ai_result["confidence"],
                    "reasoning": ai_result["reasoning"],
                }

                # Build the command envelope
                result["command"] = {
                    "command_type": "workflow.intake",
                    "phase": "P0",
                    "source_channel": "agent_mail",
                    "workflow_key": ai_result["workflow_key"],
                    "dry_run": bool(routing_config.get("dry_run", True)),
                    "actor": {
                        "id": "agent_mail",
                        "role": routing_config.get("default_actor_role", "agent_mail_intake"),
                    },
                    "payload": {
                        "email_provider": result["email_message"]["provider"],
                        "provider_message_id": result["email_message"]["provider_message_id"],
                        "classification_key": ai_result["classification_key"],
                        "classified_by": "ai",
                        "ai_confidence": ai_result["confidence"],
                    },
                }

                logger.info(
                    "AI classified: subject=%r workflow=%s confidence=%.2f",
                    subject,
                    ai_result["workflow_key"],
                    ai_result["confidence"],
                )
            else:
                # Store AI reasoning even when not classified
                result["email_message"]["raw_metadata"]["ai_classification"] = {
                    "confidence": ai_result["confidence"],
                    "reasoning": ai_result["reasoning"],
                    "classified": False,
                }

        # Generate summary for classified emails
        if result["status"] == "classified":
            subject = msg.get("subject", "")
            body = msg.get("body_text", "") or msg.get("body", "")
            summary = summarize_email(subject=subject, body=body)
            if summary:
                result["email_message"]["raw_metadata"]["ai_summary"] = summary

            automation = routing_config.get("corte_santo_automation")
            automation_enabled = (
                isinstance(automation, dict)
                and automation.get("enabled") is True
                and result.get("command", {}).get("workflow_key")
                == "corte_santo_daily_sales_reconciliation"
            )
            if automation_enabled:
                try:
                    corte_result = run_corte_initial_from_message(
                        client=client,
                        source_message=msg,
                        intake_result=result,
                        routing_config=routing_config,
                        dry_run=dry_run,
                    )
                except Exception as exc:
                    logger.exception("Corte Santo automation failed")
                    corte_result = {
                        "status": "requires_review",
                        "requires_review_reason": f"corte_automation_error:{type(exc).__name__}",
                    }
                result["corte_santo_initial_stage"] = corte_result
                result["email_message"]["raw_metadata"]["corte_santo_initial_stage"] = {
                    "status": corte_result.get("status"),
                    "requires_review_reason": corte_result.get("requires_review_reason"),
                    "artifact_dir": corte_result.get("artifact_dir"),
                }

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
            # Write email_message
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

            # Write events
            for event in result.get("events", []):
                supabase.insert_event(event)

            # Handle attachments — download and store
            attachments = msg.get("attachments") or []
            message_id = msg.get("message_id", "")
            for att in attachments:
                att_id = att.get("attachment_id")
                filename = att.get("filename", "unknown")
                content_type = att.get("content_type", "application/octet-stream")

                if not att_id:
                    continue

                try:
                    content = client.download_attachment(message_id, att_id)
                    storage_path = (
                        "agent_mail/"
                        f"{_safe_message_storage_id(message_id)}/"
                        f"{_safe_storage_segment(filename, fallback='attachment')}"
                    )
                    public_url = supabase.upload_document(
                        path=storage_path,
                        content=content,
                        content_type=content_type,
                    )

                    if public_url:
                        document_key = (
                            "email_att_"
                            f"{_safe_message_storage_id(message_id)}_"
                            f"{_safe_storage_segment(str(att_id), fallback='attachment')}"
                        )
                        source_hash = hashlib.sha256(content).hexdigest()
                        supabase.insert_document({
                            "document_key": document_key,
                            "document_type": "email_attachment",
                            "source_system": "agent_mail",
                            "source_uri": public_url,
                            "source_hash": source_hash,
                            "status": "registered",
                            "metadata": {
                                "original_filename": filename,
                                "content_type": content_type,
                                "email_message_id": message_id,
                                "attachment_id": att_id,
                            },
                        })
                        if drive_config is not None:
                            workflow_key = result.get("command", {}).get("workflow_key", "")
                            folder_key = drive_config.get("workflow_folder_map", {}).get(
                                workflow_key, ""
                            )
                            drive_result = save_document(
                                {
                                    "dry_run": False,
                                    "folder_key": folder_key,
                                    "filename": filename,
                                    "content_bytes": content,
                                    "content_type": content_type,
                                    "document_key": document_key,
                                    "document_type": "email_attachment",
                                    "source_hash": source_hash,
                                },
                                drive_config,
                            )
                            for event in drive_result.get("events", []):
                                supabase.insert_event(event)
                            if drive_result.get("document"):
                                supabase.insert_document(drive_result["document"])
                                logger.info(
                                    "Stored attachment in Drive: %s",
                                    drive_result["document"].get("source_uri"),
                                )
                            elif drive_result["status"] == "requires_review":
                                logger.warning(
                                    "Drive attachment write requires review: %s",
                                    drive_result["requires_review_reason"],
                                )
                        logger.info("Stored attachment: %s → %s", filename, public_url)
                except Exception:
                    logger.exception("Failed to download/store attachment %s", att_id)

            # If classified → create workflow_run + review
            if result["status"] == "classified" and result.get("command"):
                workflow_key = result["command"]["workflow_key"]
                workflow_id = supabase.get_workflow_id(workflow_key)
                if workflow_id:
                    idem_key = hashlib.sha256(
                        f"agent_mail:{email_record['provider_message_id']}".encode()
                    ).hexdigest()[:32]

                    corte_stage_result = result.get("corte_santo_initial_stage", {})
                    corte_business_date = (
                        corte_stage_result.get("workflow_result", {})
                        .get("workflow_run", {})
                        .get("business_date")
                    ) or datetime.now(UTC).strftime("%Y-%m-%d")

                    run_id = supabase.upsert_workflow_run({
                        "workflow_id": workflow_id,
                        "business_date": corte_business_date,
                        "status": "requires_review",
                        "source_channel": "agent_mail",
                        "idempotency_key": idem_key,
                        "input_payload": {
                            "email_subject": email_record["subject"],
                            "email_from": email_record["from_address"],
                            "classification": email_record.get("classification_key"),
                        },
                        "requires_review_reason": "Procesado por Agent Mail — pendiente de revisión humana",
                    })

                    if run_id:
                        # Create a review for the human
                        supabase.insert_review({
                            "workflow_run_id": run_id,
                            "review_key": f"agent_mail_intake_{idem_key[:12]}",
                            "status": "requires_review",
                            "metadata": {
                                "source": "agent_mail",
                                "email_subject": email_record["subject"],
                                "email_from": email_record["from_address"],
                            },
                        })

                        # Persist Corte Santo stage-1 output in Supabase for bank-watcher resume
                        corte_stage = result.get("corte_santo_initial_stage")
                        if corte_stage and corte_stage.get("status") in (
                            "waiting_for_input", "completed", "requires_review"
                        ):
                            wr = corte_stage.get("workflow_result", {}).get("workflow_run", {})
                            inp = wr.get("input_payload", {}) or {}
                            register = (
                                (wr.get("canonical_evidence", {}) or {})
                                .get("income_register", {})
                            )
                            # Prefer income_register (cortesia already in efectivo)
                            # over raw input_payload income_channels.
                            if register:
                                channels = {
                                    "amex": register.get("amex"),
                                    "debito": register.get("debito"),
                                    "credito": register.get("credito"),
                                    "efectivo": register.get("efectivo"),
                                    "paypal": register.get("paypal"),
                                    "uber": register.get("uber"),
                                    "rappi": register.get("rappi"),
                                    "propinas": register.get("propinas"),
                                }
                                channels = {k: (v if v is not None else 0.0) for k, v in channels.items()}
                            else:
                                channels = inp.get("income_channels") or {}
                            output_payload = {
                                "stage": "corte_loaded",
                                "business_date": wr.get("business_date"),
                                "income_channels": channels,
                                "income_register": register,
                                "drive_file_ids": inp.get("drive_file_ids"),
                                "workbook_paths": inp.get("workbook_paths"),
                                "workbook_outputs": inp.get("workbook_outputs"),
                                "expected_collections": [],
                                "revision_document": wr.get("revision_document"),
                            }
                            supabase.update_workflow_run_output(
                                run_id,
                                output_payload,
                                status="waiting_for_input",
                            )

            # If requires_review → create exception
            elif result["status"] == "requires_review":
                reason = email_record.get("requires_review_reason", "unknown")
                # We need a workflow_run_id for exceptions, but since this email
                # couldn't be classified, we skip creating an exception in the DB
                # (it shows as requires_review in email_messages which the dashboard reads)
                logger.info(
                    "Email requires review (reason=%s), recorded in email_messages",
                    reason,
                )

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
    drive_config_path = _env("GOOGLE_DRIVE_CONNECTOR_CONFIG")
    drive_config = _load_config(drive_config_path) if drive_config_path else None

    dry_run = not args.write
    supabase = None

    if not dry_run:
        sb_url = _env("SUPABASE_URL") or _env("NEXT_PUBLIC_SUPABASE_URL")
        sb_key = _env("SUPABASE_SERVICE_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")
        if not sb_url or not sb_key:
            logger.error(
                "Supabase URL and service key required for --write mode "
                "(SUPABASE_URL/SUPABASE_SERVICE_KEY or dashboard env aliases)"
            )
            return 1
        supabase = SupabaseWriter(url=sb_url, service_key=sb_key)

    if args.watch:
        logger.info("Watching inbox %s (dry_run=%s)...", inbox_id, dry_run)
        last_check = args.after
        while True:
            try:
                results = poll_and_classify(
                    client, routing_config, supabase,
                    drive_config=drive_config,
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
            drive_config=drive_config,
            after=args.after, dry_run=dry_run,
        )
        print(json.dumps(results, indent=2, default=str))
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
