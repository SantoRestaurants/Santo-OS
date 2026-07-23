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


def test_expected_collections_readd_current_day_on_same_date_reprocess():
    runs = [
        {
            "id": "same-day",
            "business_date": "2026-07-16",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {"business_date": "2026-07-15", "channel": "amex", "amount": 1800},
                    ],
                    "pending_collections": {"amex": 1800},
                },
                "income_register": {
                    "amex": 5717.95,
                    "debito": 23194.87,
                    "credito": 40249.13,
                    "uber": 3575,
                    "rappi": 870,
                },
            },
        },
    ]

    expected, pending_runs, _, _ = cron._build_expected_collections(runs, "2026-07-16")

    assert {item["channel"] for item in expected} == {"amex", "banorte", "uber", "rappi"}
    assert pending_runs[0]["business_date"] == "2026-07-16"


def test_legacy_platform_snapshot_keeps_older_rappi_pending_item():
    runs = [
        {
            "id": "july-18",
            "business_date": "2026-07-18",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {
                            "business_date": "2026-07-18",
                            "source_date": "2026-07-18",
                            "channel": "rappi",
                            "amount": 2460,
                        }
                    ],
                    "pending_collections": {"rappi": 2460},
                },
                "income_register": {"rappi": 2460},
            },
        },
        {
            "id": "july-19",
            "business_date": "2026-07-19",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {
                            "business_date": "2026-07-19",
                            "source_date": "2026-07-19",
                            "channel": "rappi",
                            "amount": 1785,
                        }
                    ],
                    "pending_collections": {"rappi": 1785},
                },
                "income_register": {"rappi": 1785},
            },
        },
        {
            "id": "july-20",
            "business_date": "2026-07-20",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {
                            "business_date": "2026-07-20",
                            "source_date": "2026-07-20",
                            "channel": "rappi",
                            "amount": 1245,
                        }
                    ],
                    "pending_collections": {"rappi": 1245},
                },
                "income_register": {"rappi": 1245},
            },
        },
    ]

    expected, _, _, _ = cron._build_expected_collections(runs, "2026-07-20")

    rappi = [item for item in expected if item["channel"] == "rappi"]
    assert {(item["source_date"], item["amount"]) for item in rappi} == {
        ("2026-07-18", 2460.0),
        ("2026-07-19", 1785.0),
        ("2026-07-20", 1245.0),
    }


def test_legacy_platform_aggregate_recovers_missing_rappi_item_exactly():
    runs = [
        {
            "id": "july-17",
            "business_date": "2026-07-17",
            "output_payload": {
                "income_register": {"rappi": 1050},
            },
        },
        {
            "id": "july-18",
            "business_date": "2026-07-18",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {"business_date": "2026-07-18", "channel": "rappi", "amount": 2460}
                    ]
                },
                "income_register": {"rappi": 2460},
            },
        },
        {
            "id": "july-19",
            "business_date": "2026-07-19",
            "output_payload": {
                "bank_processing": {
                    "business_date": "2026-07-19",
                    "pending_collections": {"rappi": 5295},
                },
                "bank_reconciliation": {
                    "pending_items": [
                        {"business_date": "2026-07-19", "channel": "rappi", "amount": 1785}
                    ]
                },
                "income_register": {"rappi": 1785},
            },
        },
        {
            "id": "july-20",
            "business_date": "2026-07-20",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {"business_date": "2026-07-20", "channel": "rappi", "amount": 1245}
                    ]
                },
                "income_register": {"rappi": 1245},
            },
        },
    ]

    expected, _, _, _ = cron._build_expected_collections(runs, "2026-07-20")

    rappi = [item for item in expected if item["channel"] == "rappi"]
    assert {(item["source_date"], item["amount"]) for item in rappi} == {
        ("2026-07-17", 1050.0),
        ("2026-07-18", 2460.0),
        ("2026-07-19", 1785.0),
        ("2026-07-20", 1245.0),
    }


def test_explicit_bank_snapshot_does_not_recover_settled_platform_rows():
    runs = [
        {
            "id": "old",
            "business_date": "2026-07-18",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {"business_date": "2026-07-18", "channel": "rappi", "amount": 2460}
                    ]
                },
                "income_register": {"rappi": 2460},
            },
        },
        {
            "id": "snapshot",
            "business_date": "2026-07-20",
            "output_payload": {
                "bank_reconciliation": {
                    "pending_items": [
                        {"business_date": "2026-07-20", "channel": "rappi", "amount": 1245}
                    ]
                },
                "bank_processing_snapshot": {"processed_on": "2026-07-20"},
                "income_register": {"rappi": 1245},
            },
        },
    ]

    expected, _, _, _ = cron._build_expected_collections(runs, "2026-07-20")

    assert [(item["source_date"], item["amount"]) for item in expected if item["channel"] == "rappi"] == [
        ("2026-07-20", 1245.0)
    ]


def test_pending_summary_uses_only_positive_unmatched_balances():
    items = [
        {"channel": "amex", "amount": 30000},
        {"channel": "amex", "expected_deposit": 5000},
        {"channel": "uber", "amount": 8000},
        {"channel": "rappi", "amount": 0},
    ]

    assert cron._summarize_pending(items) == {"amex": 35000, "uber": 8000}


def test_historical_bank_snapshot_is_written_once_per_business_date():
    output = {
        "falta_por_entrar_por_dia": {"2026-07-15": 62513.17},
        "bank_processing_snapshot": {"processed_on": "2026-07-15"},
    }

    assert cron._should_write_historical_bank_snapshot(output, "2026-07-15") is False
    assert cron._should_write_historical_bank_snapshot(output, "2026-07-16") is True


def test_historical_bank_snapshot_merge_never_rewrites_an_existing_day():
    output = {
        "falta_por_entrar_por_dia": {"2026-07-18": 900.0},
        "falta_por_entrar_detalle_por_dia": {
            "2026-07-18": {"amex": 500.0, "banorte": 400.0},
        },
    }

    assert cron._merge_historical_outstanding(
        output,
        {"2026-07-18", "2026-07-19"},
        700.0,
    ) == {
        "2026-07-18": 900.0,
        "2026-07-19": 700.0,
    }
    assert cron._merge_historical_outstanding_details(
        output,
        {"2026-07-18", "2026-07-19"},
        {"amex": 300.0, "banorte": 400.0},
    ) == {
        "2026-07-18": {"amex": 500.0, "banorte": 400.0},
        "2026-07-19": {"amex": 300.0, "banorte": 400.0},
    }


def test_missing_bank_documents_clear_only_selected_day_bank_validation():
    output = {
        "bank_reconciliation": {"pending_collections": {"banorte": 19316.10}},
        "bank_processing_snapshot": {"processed_on": "2026-07-16"},
        "bank_match": {"validated_by": "bank_statement"},
        "bank_validated_at": "2026-07-16T12:00:00Z",
        "bank_validation_status": "bank_requires_review",
        "stage": "bank_validated",
        "falta_por_entrar_por_dia": {
            "2026-07-15": 81829.27,
            "2026-07-16": 19316.10,
        },
        "revision_document": {
            "falta_por_entrar": {"banorte": 19316.10},
            "bank_validation_status": "bank_requires_review",
        },
        "saldos": {"banorte": 1411301.34},
    }

    cron._clear_bank_validation_for_missing_documents(output, "2026-07-16")

    assert "bank_reconciliation" not in output
    assert "bank_processing_snapshot" not in output
    assert "bank_match" not in output
    assert "bank_validated_at" not in output
    assert output["bank_validation_status"] == "bank_pending_upload"
    assert output["stage"] == "corte_loaded"
    assert output["falta_por_entrar_por_dia"] == {"2026-07-15": 81829.27}
    assert output["revision_document"] == {"bank_validation_status": "bank_pending_upload"}
    assert "saldos" not in output


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
