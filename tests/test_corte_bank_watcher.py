from services.drive_connector.corte_bank_watcher import detect_bank_stage_trigger


def test_bank_pair_triggers_resume_command() -> None:
    result = detect_bank_stage_trigger(
        [
            {"id": "1", "name": "AMEX_SANTO_040626.xls"},
            {"id": "2", "name": "BANORTE_SANTO_040626.csv"},
        ],
        restaurant_key="santo",
        business_date="2026-06-04",
    )
    assert result["status"] == "triggered"
    assert result["command"]["command_type"] == "workflow.resume"


def test_missing_bank_file_waits() -> None:
    result = detect_bank_stage_trigger(
        [{"id": "2", "name": "BANORTE_SANTO_040626.csv"}],
        restaurant_key="santo",
        business_date="2026-06-04",
    )
    assert result["status"] == "waiting_for_input"
    assert result["missing"] == ["amex_statement"]
