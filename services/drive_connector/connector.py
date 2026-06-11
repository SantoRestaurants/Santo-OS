"""Configurable Google Drive connector.

Drive is a document transport and repository. Supabase remains the source of
truth for workflow state, document metadata, review status, and audit events.
"""

from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import os
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _has_unconfirmed_value(value: Any) -> bool:
    if value in (None, "", "[CONFIRM]"):
        return True
    if isinstance(value, str):
        return "[CONFIRM]" in value
    return False


def _event(event_type: str, severity: str, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "aggregate_type": "document",
        "aggregate_id": None,
        "event_type": event_type,
        "severity": severity,
        "payload": payload,
        "created_at": _now(),
    }


def _folder_config(folder_key: str, config: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    if config.get("confirmed") is not True:
        return None, "drive_connector_config_not_confirmed"

    folder = config.get("folder_map", {}).get(folder_key)
    if not isinstance(folder, dict):
        return None, f"drive_folder_key_not_mapped:{folder_key}"

    if folder.get("confirmation_status") != "confirmed":
        return None, f"drive_folder_not_confirmed:{folder_key}"

    if _has_unconfirmed_value(folder.get("folder_id")):
        return None, f"drive_folder_id_missing:{folder_key}"

    return folder, None


class DriveClient:
    """Small Drive API client with shared-drive support."""

    def __init__(self, access_token: str, transport: httpx.BaseTransport | None = None):
        self.http = httpx.Client(
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=60.0,
            transport=transport,
        )

    def upload(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str,
        folder_id: str,
        app_properties: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        boundary = f"santoos-{uuid.uuid4().hex}"
        metadata = {
            "name": filename,
            "parents": [folder_id],
            "appProperties": app_properties or {},
        }
        body = (
            f"--{boundary}\r\n"
            "Content-Type: application/json; charset=UTF-8\r\n\r\n"
            f"{json.dumps(metadata, ensure_ascii=True)}\r\n"
            f"--{boundary}\r\n"
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")

        response = self.http.post(
            DRIVE_UPLOAD_URL,
            params={
                "uploadType": "multipart",
                "supportsAllDrives": "true",
                "fields": "id,name,mimeType,parents,webViewLink",
            },
            content=body,
            headers={"Content-Type": f"multipart/related; boundary={boundary}"},
        )
        response.raise_for_status()
        return response.json()


def save_document(
    request: dict[str, Any],
    config: dict[str, Any] | None = None,
    *,
    client: DriveClient | None = None,
) -> dict[str, Any]:
    """Save a document to a confirmed Drive folder or propose the operation."""
    config = config or {}
    dry_run = bool(request.get("dry_run", True))
    folder_key = str(request.get("folder_key", "")).strip()
    filename = str(request.get("filename", "")).strip()
    source_path = request.get("source_path")
    content_bytes = request.get("content_bytes")
    has_content_bytes = isinstance(content_bytes, bytes)
    content_type = request.get("content_type") or mimetypes.guess_type(filename)[0] or "application/octet-stream"

    missing = [
        name
        for name, value in (("folder_key", folder_key), ("filename", filename))
        if _has_unconfirmed_value(value)
    ]
    if not has_content_bytes and _has_unconfirmed_value(source_path):
        missing.append("source_path_or_content_bytes")
    folder, folder_error = _folder_config(folder_key, config) if folder_key else (None, None)
    if folder_error:
        missing.append(folder_error)

    path = Path(str(source_path)) if source_path else None
    if path and not path.is_file():
        missing.append("source_path_not_found")

    if missing:
        return {
            "status": "requires_review",
            "requires_review_reason": ", ".join(missing),
            "document": None,
            "events": [
                _event(
                    "drive.document.requires_review",
                    "warning",
                    {"folder_key": folder_key, "filename": filename, "missing": missing},
                )
            ],
            "dry_run": dry_run,
        }

    proposed_document = {
        "document_key": request.get("document_key") or filename,
        "document_type": request.get("document_type", "unclassified"),
        "source_system": "drive",
        "source_uri": folder["drive_url"],
        "drive_file_id": None,
        "source_hash": request.get("source_hash"),
        "status": "received",
        "metadata": {
            "folder_key": folder_key,
            "filename": filename,
            "drive_write_mode": "dry_run" if dry_run else "live",
        },
    }

    if dry_run:
        return {
            "status": "ready_for_upload",
            "requires_review_reason": None,
            "document": proposed_document,
            "events": [
                _event(
                    "drive.document.upload_proposed",
                    "info",
                    {"folder_key": folder_key, "filename": filename},
                )
            ],
            "dry_run": True,
        }

    access_token = os.environ.get("GOOGLE_DRIVE_ACCESS_TOKEN", "")
    if client is None and not access_token:
        return {
            "status": "requires_review",
            "requires_review_reason": "google_drive_access_token_missing",
            "document": None,
            "events": [
                _event(
                    "drive.document.requires_review",
                    "warning",
                    {"folder_key": folder_key, "filename": filename, "missing": ["credentials"]},
                )
            ],
            "dry_run": False,
        }

    drive = client or DriveClient(access_token)
    uploaded = drive.upload(
        filename=filename,
        content=content_bytes if has_content_bytes else path.read_bytes(),
        content_type=str(content_type),
        folder_id=folder["folder_id"],
        app_properties={
            "santoos_folder_key": folder_key,
            "santoos_document_key": str(proposed_document["document_key"]),
        },
    )
    proposed_document["drive_file_id"] = uploaded.get("id")
    proposed_document["source_uri"] = uploaded.get("webViewLink") or folder["drive_url"]
    proposed_document["status"] = "registered"
    proposed_document["metadata"]["drive_response"] = uploaded

    return {
        "status": "registered",
        "requires_review_reason": None,
        "document": proposed_document,
        "events": [
            _event(
                "drive.document.uploaded",
                "info",
                {"folder_key": folder_key, "filename": filename, "drive_file_id": uploaded.get("id")},
            )
        ],
        "dry_run": False,
    }


def _load_json(path: str) -> dict[str, Any]:
    with Path(path).open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    if not isinstance(loaded, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return loaded


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Save a SantoOS document to Google Drive.")
    parser.add_argument("--input", required=True, help="Path to the document request JSON.")
    parser.add_argument("--config", required=True, help="Path to the Drive connector config JSON.")
    parser.add_argument("--dry-run", action="store_true", help="Propose the upload without writing to Drive.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    try:
        request = _load_json(args.input)
        if args.dry_run:
            request["dry_run"] = True
        print(json.dumps(save_document(request, _load_json(args.config)), indent=2, sort_keys=True))
        return 0
    except Exception:
        logging.exception("drive_connector_failure")
        return 1


if __name__ == "__main__":
    sys.exit(main())
