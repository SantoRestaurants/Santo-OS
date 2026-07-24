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


def test_expected_collections_include_new_corte_channels_after_latest_snapshot():
    runs = [
        {
            "id": "snapshot",
            "business_date": "2026-07-05",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {"business_date": "2026-07-04", "channel": "amex", "amount": 1200}
                    ],
                    "pending_collections": {"amex": 1200},
                }
            },
        },
        {
            "id": "new",
            "business_date": "2026-07-06",
            "output_payload": {
                "expected_collections": [
                    {"business_date": "2026-07-06", "channel": "amex", "amount": 3000}
                ],
                "income_register": {
                    "amex": 3000,
                    "debito": 4000,
                    "credito": 5000,
                    "uber": 600,
                    "rappi": 700,
                    "efectivo": 800,
                    "propinas": 900,
                },
            },
        },
    ]

    expected, pending_runs, _, _ = cron._build_expected_collections(runs, "2026-07-06")

    by_channel = {item["channel"]: item["expected_deposit"] for item in expected}
    assert by_channel["amex"] == 3000
    assert by_channel["banorte"] == 9000
    assert by_channel["uber"] == 600
    assert by_channel["rappi"] == 700
    assert "efectivo" not in by_channel
    assert "propinas" not in by_channel
    assert any(item["business_date"] == "2026-07-04" for item in expected)
    assert {item["business_date"] for item in pending_runs} == {"2026-07-05", "2026-07-06"}


def test_expected_collections_do_not_recreate_days_before_authoritative_snapshot():
    runs = [
        {
            "id": "old",
            "business_date": "2026-07-03",
            "output_payload": {
                "expected_collections": [
                    {"business_date": "2026-07-03", "channel": "amex", "amount": 3000}
                ],
                "income_register": {"amex": 3000, "debito": 1000, "credito": 2000},
            },
        },
        {
            "id": "snapshot",
            "business_date": "2026-07-05",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {"business_date": "2026-07-04", "channel": "banorte", "amount": 500}
                    ],
                    "pending_collections": {"banorte": 500},
                }
            },
        },
    ]

    expected, _, _, _ = cron._build_expected_collections(runs, "2026-07-05")

    assert expected == [
        {
            "business_date": "2026-07-04",
            "source_date": "2026-07-04",
            "channel": "banorte",
            "amount": 500.0,
            "expected_deposit": 500.0,
        }
    ]


def test_pending_summary_uses_only_positive_unmatched_balances():
    items = [
        {"channel": "amex", "amount": 30000},
        {"channel": "amex", "expected_deposit": 5000},
        {"channel": "uber", "amount": 8000},
        {"channel": "rappi", "amount": 0},
    ]

    assert cron._summarize_pending(items) == {"amex": 35000, "uber": 8000}


def test_normalized_snapshot_preserves_gross_amount_and_net_bank_match_amount():
    normalized = cron._normalize_expected_collection(
        {
            "business_date": "2026-07-08",
            "channel": "amex",
            "amount": 13786.94,
            "expected_deposit": 13323.15,
        },
        "2026-07-08",
    )

    assert normalized["amount"] == 13786.94
    assert normalized["expected_deposit"] == 13323.15


def test_cxc_expected_collection_rejects_legacy_channel_sales_rows():
    row = {
        "id": "legacy-debit",
        "opened_on": "2026-07-09",
        "principal": 16868.45,
        "settled_principal": 0,
        "receivable_key": "restaurant:2026-07-09:debito",
        "evidence": {"kind": "channel_sales", "channel": "debito"},
    }

    assert cron._cxc_expected_collection(row) is None


def test_cxc_expected_collection_keeps_named_manual_receivable():
    row = {
        "id": "cxc-diego",
        "opened_on": "2026-07-09",
        "principal": 6715,
        "settled_principal": 0,
        "receivable_key": "restaurant:manual-cxc-2026-07-09:diego-villanueva",
        "evidence": {"kind": "opening", "description": "Diego Villanueva", "channel": "paypal"},
    }

    assert cron._cxc_expected_collection(row) == {
        "business_date": "2026-07-09",
        "channel": "cxc",
        "amount": 6715.0,
        "expected_deposit": 6715.0,
        "source_date": "2026-07-09",
        "receivable_id": "cxc-diego",
        "receivable_key": "restaurant:manual-cxc-2026-07-09:diego-villanueva",
        "description": "Diego Villanueva",
    }
