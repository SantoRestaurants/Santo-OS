from services.agent_mail.corte_santo_automation import run_corte_initial_from_message


class FakeAgentMailClient:
    def download_attachment(self, message_id: str, attachment_id: str) -> bytes:
        assert message_id == "msg-1"
        assert attachment_id == "att-1"
        return b"not-a-real-workbook"


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
