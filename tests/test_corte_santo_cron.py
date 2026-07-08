from argparse import Namespace

from services.scheduler import corte_santo_cron as cron


def test_agent_mail_requires_api_key(monkeypatch):
    monkeypatch.delenv("AGENTMAIL_API_KEY", raising=False)

    result = cron.run_agent_mail_once(
        config_path="services/agent_mail/config.json",
        write=False,
    )

    assert result["status"] == "requires_review"
    assert result["requires_review_reason"] == "agentmail_api_key_missing"


def test_bank_watcher_requires_business_date(monkeypatch):
    monkeypatch.setenv("CORTE_SANTO_BANK_UPLOAD_FOLDER_ID", "folder-123")
    monkeypatch.delenv("CORTE_SANTO_BANK_WATCH_DATE", raising=False)

    result = cron.run_bank_watcher_once(
        config_path="workflows/corte_santo/fixtures/config_confirmed.json",
        restaurant_key="santo",
        business_date=None,
    )

    assert result["status"] == "requires_review"
    assert result["requires_review_reason"] == "corte_santo_bank_business_date_missing"


def test_run_all_aggregates_requires_review(monkeypatch):
    monkeypatch.delenv("AGENTMAIL_API_KEY", raising=False)

    result = cron.run_all(
        Namespace(
            job="agent-mail",
            routing_config="services/agent_mail/config.json",
            corte_config="workflows/corte_santo/fixtures/config_confirmed.json",
            restaurant_key="santo",
            business_date=None,
            after=None,
            write=False,
            force_reprocess=False,
        )
    )

    assert result["status"] == "requires_review"
    assert result["jobs"][0]["job"] == "agent-mail"




def test_empty_latest_snapshot_does_not_revive_settled_items():
    runs = [
        {
            "id": "old",
            "business_date": "2026-06-28",
            "output_payload": {"income_register": {"amex": 30000}},
        },
        {
            "id": "settled",
            "business_date": "2026-07-05",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [],
                    "pending_collections": {},
                }
            },
        },
    ]

    expected, _, _, _ = cron._build_expected_collections(runs, "2026-07-05")

    assert expected == []


def test_pending_summary_uses_only_positive_unmatched_balances():
    items = [
        {"channel": "amex", "amount": 30000},
        {"channel": "amex", "expected_deposit": 5000},
        {"channel": "uber", "amount": 8000},
        {"channel": "rappi", "amount": 0},
    ]

    assert cron._summarize_pending(items) == {"amex": 35000, "uber": 8000}
