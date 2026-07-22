from pathlib import Path

from services.agent_mail import corte_santo_automation as automation
from services.agent_mail.corte_santo_automation import run_corte_initial_from_message


class FakeAgentMailClient:
    def download_attachment(self, message_id: str, attachment_id: str) -> bytes:
        assert message_id == "msg-1"
        assert attachment_id == "att-1"
        return b"not-a-real-workbook"


class GenericAttachmentClient:
    def download_attachment(self, message_id: str, attachment_id: str) -> bytes:
        fixture = Path("workflows/corte_santo/fixtures/santo_corte_sample.xlsx")
        return fixture.read_bytes()


def test_corte_agent_mail_automation_requires_workbook_sources(monkeypatch) -> None:
    monkeypatch.delenv("CORTE_SANTO_INGRESOS_PATH", raising=False)
    monkeypatch.delenv("CORTE_SANTO_FORECAST_PATH", raising=False)
    monkeypatch.delenv("CORTE_SANTO_INGRESOS_FILE_ID", raising=False)
    monkeypatch.delenv("CORTE_SANTO_FORECAST_FILE_ID", raising=False)

    result = run_corte_initial_from_message(
        client=FakeAgentMailClient(),
        source_message={
            "message_id": "msg-1",
            "subject": "[CORTE] SANTO 04 JUNIO 2026 - PRUEBA END TO END",
            "attachments": [
                {"attachment_id": "att-1", "filename": "SANTO CORTE 04 JUNIO 2026.xlsx"}
            ],
        },
        intake_result={
            "command": {"workflow_key": "corte_santo_daily_sales_reconciliation"}
        },
        routing_config={
            "corte_santo_automation": {
                "config_path": "workflows/corte_santo/fixtures/config_confirmed.json"
            }
        },
        dry_run=True,
    )

    assert result["status"] == "requires_review"
    assert result["requires_review_reason"] == "corte_workbook_sources_missing"
    assert result["request"]["payload"]["business_date"] == "2026-06-04"
    assert result["request"]["payload"]["restaurant_key"] == "santo"


def test_generic_attachment_uses_content_and_keeps_parser_extension(monkeypatch) -> None:
    monkeypatch.setattr(
        automation,
        "_workbook_paths",
        lambda *args, **kwargs: ({}, {}, {}, ["configured_workbooks_missing"]),
    )

    result = run_corte_initial_from_message(
        client=GenericAttachmentClient(),
        source_message={
            "message_id": "msg-generic",
            "subject": "[CORTE] SANTO 04 JUNIO 2026",
            "attachments": [{
                "attachment_id": "att-generic",
                "filename": "attachment",
                "content_type": "application/octet-stream",
            }],
        },
        intake_result={
            "command": {"workflow_key": "corte_santo_daily_sales_reconciliation"}
        },
        routing_config={
            "corte_santo_automation": {
                "config_path": "workflows/corte_santo/fixtures/config_confirmed.json"
            }
        },
        dry_run=True,
    )

    document = result["request"]["payload"]["documents"][0]
    assert document["document_type"] == "corte_excel"
    assert Path(document["source_path"]).suffix.lower() == ".xlsx"


def test_workbooks_are_discovered_from_drive_folder(monkeypatch, tmp_path: Path) -> None:
    class FakeDrive:
        def list_files(self, *, folder_id: str):
            assert folder_id == "root-folder"
            return [
                {
                    "id": "ingresos-id",
                    "name": "06. Santo_Ingresos Junio 2026.xlsx",
                    "modifiedTime": "2026-06-01T00:00:00Z",
                },
                {
                    "id": "forecast-id",
                    "name": "06. SANTO_FC_Junio 2026.xlsx",
                    "modifiedTime": "2026-06-01T00:00:00Z",
                },
            ]

        def download(self, file_id: str) -> bytes:
            return f"content:{file_id}".encode("ascii")

    monkeypatch.delenv("CORTE_SANTO_INGRESOS_PATH", raising=False)
    monkeypatch.delenv("CORTE_SANTO_FORECAST_PATH", raising=False)
    monkeypatch.delenv("CORTE_SANTO_INGRESOS_FILE_ID", raising=False)
    monkeypatch.delenv("CORTE_SANTO_FORECAST_FILE_ID", raising=False)
    monkeypatch.delenv("CORTE_SANTO_DRIVE_FOLDER_ID", raising=False)
    monkeypatch.setattr(automation, "build_drive_client", lambda: (FakeDrive(), None))

    paths, _outputs, drive_file_ids, missing = automation._workbook_paths(
        tmp_path,
        "2026-06-04",
        {"drive_runtime": {"root_folder_id": "root-folder"}},
    )

    assert missing == []
    assert drive_file_ids == {"ingresos": "ingresos-id", "forecast": "forecast-id"}
    assert Path(paths["ingresos"]).read_bytes() == b"content:ingresos-id"
    assert Path(paths["forecast"]).read_bytes() == b"content:forecast-id"
