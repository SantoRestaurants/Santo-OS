from services.drive_connector.corte_bank_watcher import detect_bank_stage_trigger, poll_bank_folder_once
from workflows.corte_santo.bank_statement_parser import bank_statement_deposit_keys, exclude_bank_statement_deposits


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


def test_generic_bank_names_can_be_classified_from_content() -> None:
    result = detect_bank_stage_trigger(
        [
            {
                "id": "1",
                "name": "archivo supervisor.xls",
                "content_sample": b"Fecha de pago\tMonto del pago\n2026-06-05\t9909.45",
            },
            {
                "id": "2",
                "name": "movimientos.csv",
                "content_sample": "DESCRIPCION,DEPOSITOS,RETIROS\nREST SANTO,100,",
            },
        ],
        restaurant_key="santo",
        business_date="2026-06-04",
    )

    assert result["status"] == "triggered"
    docs = result["command"]["payload"]["documents"]
    assert {doc["document_type"] for doc in docs} == {"amex_statement", "banorte_statement"}


def test_poll_bank_folder_downloads_samples_for_generic_xls() -> None:
    class FakeDrive:
        def list_files(self, *, folder_id: str):
            assert folder_id == "folder"
            return [
                {"id": "1", "name": "archivo supervisor.xls"},
                {"id": "2", "name": "banorte.csv"},
            ]

        def download(self, file_id: str) -> bytes:
            assert file_id == "1"
            return b"Fecha de pago\tMonto del pago"

    result = poll_bank_folder_once(
        FakeDrive(),
        folder_id="folder",
        restaurant_key="santo",
        business_date="2026-06-04",
    )

    assert result["status"] == "triggered"


def test_cumulative_statement_can_exclude_deposits_consumed_by_previous_batch() -> None:
    deposits = [
        {"source": "banorte", "amount": 10.0, "description": "REST SANTO", "detail": "-", "operation_date": "16/07/2026"},
        {"source": "banorte", "amount": 20.0, "description": "REST SANTO", "detail": "-", "operation_date": "16/07/2026"},
    ]
    statement = {"status": "ok", "deposits": deposits, "deposits_by_source": {"banorte": 30.0}}

    filtered = exclude_bank_statement_deposits(
        statement,
        {bank_statement_deposit_keys(deposits)[0]},
    )

    assert filtered["deposits"] == [deposits[1]]
    assert filtered["deposits_by_source"] == {"banorte": 20.0}
