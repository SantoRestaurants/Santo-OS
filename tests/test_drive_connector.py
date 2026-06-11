from pathlib import Path

from services.drive_connector.connector import save_document


FIXTURE_DIR = Path(__file__).resolve().parents[1] / "services" / "drive_connector" / "fixtures"
CONFIRMED_CONFIG = {
    "confirmed": True,
    "folder_map": {
        "corte_santo_root": {
            "folder_id": "folder-123",
            "drive_url": "https://drive.google.com/drive/folders/folder-123",
            "confirmation_status": "confirmed",
        }
    },
}
REQUEST = {
    "dry_run": True,
    "folder_key": "corte_santo_root",
    "filename": "corte.pdf",
    "source_path": str(FIXTURE_DIR / "demo_document.txt"),
    "document_key": "corte_pdf",
    "document_type": "daily_sales_reconciliation",
}


def test_drive_unconfirmed_folder_requires_review() -> None:
    result = save_document(REQUEST, {"confirmed": False, "folder_map": {}})
    assert result["status"] == "requires_review"
    assert "drive_connector_config_not_confirmed" in result["requires_review_reason"]


def test_drive_dry_run_proposes_document_without_upload() -> None:
    result = save_document(REQUEST, CONFIRMED_CONFIG)
    assert result["status"] == "ready_for_upload"
    assert result["document"]["source_system"] == "drive"
    assert result["document"]["drive_file_id"] is None
    assert result["events"][0]["event_type"] == "drive.document.upload_proposed"


def test_drive_live_write_without_credentials_requires_review(monkeypatch) -> None:
    monkeypatch.delenv("GOOGLE_DRIVE_ACCESS_TOKEN", raising=False)
    result = save_document({**REQUEST, "dry_run": False}, CONFIRMED_CONFIG)
    assert result["status"] == "requires_review"
    assert result["requires_review_reason"] == "google_drive_access_token_missing"


def test_drive_live_write_returns_registered_document() -> None:
    class FakeDriveClient:
        def upload(self, **kwargs):
            assert kwargs["folder_id"] == "folder-123"
            return {
                "id": "drive-file-123",
                "name": kwargs["filename"],
                "webViewLink": "https://drive.google.com/file/d/drive-file-123/view",
            }

    result = save_document({**REQUEST, "dry_run": False}, CONFIRMED_CONFIG, client=FakeDriveClient())
    assert result["status"] == "registered"
    assert result["document"]["drive_file_id"] == "drive-file-123"
    assert result["events"][0]["event_type"] == "drive.document.uploaded"


def test_drive_live_write_accepts_downloaded_attachment_bytes() -> None:
    class FakeDriveClient:
        def upload(self, **kwargs):
            assert kwargs["content"] == b"attachment-content"
            return {"id": "drive-file-bytes", "webViewLink": "https://drive.example/file"}

    request = {
        "dry_run": False,
        "folder_key": "corte_santo_root",
        "filename": "attachment.pdf",
        "content_bytes": b"attachment-content",
    }
    result = save_document(request, CONFIRMED_CONFIG, client=FakeDriveClient())
    assert result["status"] == "registered"
