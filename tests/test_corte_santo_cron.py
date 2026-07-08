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


def test_expected_collections_carry_only_latest_unmatched_items():
    runs = [
        {
            "id": "june-28",
            "business_date": "2026-06-28",
            "output_payload": {"income_register": {"amex": 30000, "debito": 20000}},
        },
        {
            "id": "july-04-snapshot",
            "business_date": "2026-07-04",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {
                            "business_date": "2026-06-28",
                            "source_date": "2026-06-28",
                            "channel": "debito",
                            "amount": 20000,
                            "expected_deposit": 20000,
                        }
                    ],
                    "pending_collections": {"debito": 20000},
                }
            },
        },
        {
            "id": "july-05",
            "business_date": "2026-07-05",
            "output_payload": {"income_register": {"uber": 8000}},
        },
    ]

    expected, _, _, _ = cron._build_expected_collections(runs, "2026-07-05")

    assert {(item["channel"], item["amount"]) for item in expected} == {
        ("banorte", 20000),
        ("uber", 8000),
    }
    assert not any(item["channel"] == "amex" for item in expected)


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


def test_pending_snapshot_normalization_dedupes_rerun_items():
    items = [
        {
            "business_date": "2026-07-05",
            "source_date": "2026-07-05",
            "channel": "amex",
            "amount": 75732.09,
            "expected_deposit": 75732.09,
            "expected_payment_date": "2026-07-08",
        },
        {
            "source_date": "2026-07-05",
            "channel": "amex",
            "amount": 75732.09,
            "expected_deposit": 75732.09,
            "expected_payment_date": "2026-07-08",
        },
        {
            "source_date": "2026-07-05",
            "channel": "amex",
            "amount": 75732.09,
            "expected_deposit": 75732.09,
            "expected_payment_date": "2026-07-08",
        },
        {
            "source_date": "2026-07-05",
            "channel": "amex",
            "amount": 9064.82,
            "expected_deposit": 9064.82,
            "expected_payment_date": "2026-07-09",
        },
    ]

    normalized = cron._normalize_pending_snapshot(items)

    assert [
        (item["business_date"], item["channel"], item["expected_deposit"], item.get("expected_payment_date"))
        for item in normalized
    ] == [
        ("2026-07-05", "amex", 75732.09, "2026-07-08"),
        ("2026-07-05", "amex", 9064.82, "2026-07-09"),
    ]


def test_expected_collection_dedupe_prevents_duplicate_cxc_snapshot_append():
    items = [
        {
            "business_date": "2026-06-29",
            "source_date": "2026-06-29",
            "channel": "cxc",
            "amount": 535.0,
            "expected_deposit": 535.0,
        },
        {
            "business_date": "2026-06-29",
            "source_date": "2026-06-29",
            "channel": "cxc",
            "amount": 535.0,
            "expected_deposit": 535.0,
            "receivable_key": "santo:2026-06-29:cxc:535",
        },
    ]

    deduped = cron._dedupe_expected_collections(items)

    assert len(deduped) == 1
    assert deduped[0]["expected_deposit"] == 535.0


def test_pending_summary_uses_only_positive_unmatched_balances():
    items = [
        {"channel": "amex", "amount": 30000},
        {"channel": "amex", "expected_deposit": 5000},
        {"channel": "uber", "amount": 8000},
        {"channel": "rappi", "amount": 0},
    ]

    assert cron._summarize_pending(items) == {"amex": 35000, "uber": 8000}


def test_legacy_channel_receivables_are_not_canonical_cxc():
    assert not cron._is_canonical_cxc_receivable(
        {
            "receivable_key": "restaurant:2026-07-06:efectivo",
            "evidence": {},
        }
    )
    assert cron._is_canonical_cxc_receivable(
        {
            "receivable_key": "restaurant:2026-07-06:535.00:abc",
            "evidence": {"kind": "opening", "principal": 535.0, "source": "vision_extractor"},
        }
    )
