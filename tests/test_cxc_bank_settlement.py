from workflows.corte_santo.bank_reconciliation import reconcile_bank_stage


def test_cxc_bank_transfer_allocates_partially_to_receivable() -> None:
    result = reconcile_bank_stage(
        [{
            "business_date": "2026-07-09",
            "source_date": "2026-07-09",
            "channel": "cxc",
            "amount": 3185.0,
            "receivable_id": "la-valisse",
            "receivable_key": "restaurant:manual:la-valisse",
        }],
        {
            "status": "ok",
            "deposits": [{"source": "cxc", "amount": 1410.0, "operation_date": "18/07/2026"}],
            "additional_expenses": [],
        },
        {"status": "ok", "payments": []},
        settlement_rules={"cxc": {"mode": "fifo_partial"}},
    )

    assert result["pending_collections"] == {"cxc": 1775.0}
    allocation = result["matches"][0]["allocations"][0]
    assert allocation["receivable_id"] == "la-valisse"
    assert allocation["amount"] == 1410.0
