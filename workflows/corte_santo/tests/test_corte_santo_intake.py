from __future__ import annotations

import importlib.util
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "script.py"
SPEC = importlib.util.spec_from_file_location("corte_santo_script", MODULE_PATH)
assert SPEC is not None
assert SPEC.loader is not None
corte_santo_script = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(corte_santo_script)


def _matched_close() -> dict[str, dict[str, float]]:
    return {
        "amex": {"consumo": 2488.0, "propina": 373.2},
        "bancos": {"consumo": 28235.0, "propina": 3904.27},
        "efectivo": {"consumo": 670.0, "propina": 670.0},
        "transferencia": {"consumo": 0.0, "propina": 0.0},
        "plataformas": {"consumo": 2180.0, "propina": 0.0},
    }


BASE_INPUT = {
    "workflow_key": "corte_santo_daily_sales_reconciliation",
    "phase": "P0",
    "dry_run": True,
    "source_channel": "agent_mail",
    "payload": {
        "business_date": "2026-04-14",
        "restaurant_key": "santo",
        "vta_por_dia": [
            {"dia": "Martes", "fecha": "2026-04-14", "meta_vta": 64359.05, "venta_real": 34058.0}
        ],
        "vta_meta_mes": {"meta_vta": 3480000.0},
        "saldos": {
            "prov_aguinaldos": 28149.06,
            "saldo_banorte": 689091.85,
            "prov_utilidades": 250712.59,
        },
        "falta_por_entrar": {"cobros_amex": 14908.55, "cxc": 11891.5},
        "cierre_terminal": _matched_close(),
        "cierre_sistema": _matched_close(),
        "documents": [
            {
                "document_key": "corte_excel",
                "document_type": "corte_excel",
                "source_system": "agent_mail",
                "source_uri": "email://msg-corte-001/corte.xlsx",
                "source_hash": "hash-001",
            },
            {
                "document_key": "wansoft_system_close",
                "document_type": "wansoft_system_close",
                "source_system": "agent_mail",
                "source_uri": "email://msg-corte-001/wansoft.pdf",
                "source_hash": "hash-002",
            },
        ],
    },
}

CONFIRMED_CONFIG = {
    "workflow_key": "corte_santo_daily_sales_reconciliation",
    "restaurant_map": {"santo": {"display_name": "SANTO"}},
    "drive_folder_map": {"santo": "drive-folder-1"},
    "mandatory_attachments": ["corte_excel", "wansoft_system_close"],
    "reviewer_map": {"default": "admin_ops"},
    "payment_forms": [
        "amex",
        "bancos",
        "efectivo",
        "transferencia",
        "plataformas",
    ],
    "thresholds": {"reconciliation_tolerance": 0.0},
}


def test_missing_config_requires_review() -> None:
    result = corte_santo_script.run(BASE_INPUT, {})

    assert result["status"] == "requires_review"
    assert result["workflow_run"]["status"] == "requires_review"
    assert result["exceptions"][0]["exception_type"] == "missing_config"


def test_missing_restaurant_requires_review() -> None:
    payload = {**BASE_INPUT["payload"], "restaurant_key": "[CONFIRM]"}
    result = corte_santo_script.run({**BASE_INPUT, "payload": payload}, CONFIRMED_CONFIG)

    assert result["status"] == "requires_review"
    assert "payload.restaurant_key" in result["exceptions"][0]["details"]["missing"]


def test_matched_close_is_ready_for_approval() -> None:
    result = corte_santo_script.run(BASE_INPUT, CONFIRMED_CONFIG)

    assert result["status"] == "ready_for_approval"
    assert result["workflow_run"]["business_date"] == "2026-04-14"
    assert result["documents"][0]["status"] == "registered"
    recon = result["workflow_run"]["reconciliation"]
    assert recon["status"] == "ready_for_approval"
    assert recon["totals"]["total_real"] == recon["totals"]["total_sistema"]
    assert result["exceptions"] == []


def test_document_missing_hash_requires_review() -> None:
    documents = [
        {**BASE_INPUT["payload"]["documents"][0], "source_hash": "[CONFIRM]"},
        BASE_INPUT["payload"]["documents"][1],
    ]
    payload = {**BASE_INPUT["payload"], "documents": documents}
    result = corte_santo_script.run({**BASE_INPUT, "payload": payload}, CONFIRMED_CONFIG)

    assert result["status"] == "requires_review"
    assert any(d["status"] == "requires_review" for d in result["documents"])
    assert any(e["exception_type"] == "document_requires_review" for e in result["exceptions"])


def test_missing_mandatory_attachments_requires_review() -> None:
    payload = {**BASE_INPUT["payload"], "documents": []}
    result = corte_santo_script.run({**BASE_INPUT, "payload": payload}, CONFIRMED_CONFIG)

    assert result["status"] == "requires_review"
    assert any(e["exception_type"] == "missing_documents" for e in result["exceptions"])


def test_payment_form_discrepancy_requires_review() -> None:
    terminal = _matched_close()
    terminal["bancos"] = {"consumo": 30718.0, "propina": 3904.27}
    payload = {**BASE_INPUT["payload"], "cierre_terminal": terminal}
    result = corte_santo_script.run({**BASE_INPUT, "payload": payload}, CONFIRMED_CONFIG)

    assert result["status"] == "requires_review"
    keys = {e["exception_key"] for e in result["exceptions"]}
    assert "payment_form_discrepancy_bancos" in keys
    assert "total_real_vs_sistema_discrepancy" in keys


def test_idempotency_key_is_stable() -> None:
    first = corte_santo_script.run(BASE_INPUT, CONFIRMED_CONFIG)
    second = corte_santo_script.run(BASE_INPUT, CONFIRMED_CONFIG)

    assert first["idempotency_key"] == second["idempotency_key"]


def test_reconcile_without_confirmed_config_requires_review() -> None:
    result = corte_santo_script.reconcile({"amex": {"consumo": 1, "propina": 0}}, {}, {})

    assert result["status"] == "requires_review"
    assert result["exceptions"][0]["exception_key"] == "missing_reconciliation_config"
    assert result["totals"]["total_real"] is None


def test_reconcile_groups_banorte_into_bancos() -> None:
    terminal = {
        "banorte_debito": {"consumo": 100.0, "propina": 10.0},
        "banorte_credito": {"consumo": 200.0, "propina": 20.0},
    }
    sistema = {
        "banorte_debito": {"consumo": 100.0, "propina": 10.0},
        "banorte_credito": {"consumo": 150.0, "propina": 20.0},
    }
    config = {
        "payment_forms": ["banorte_debito", "banorte_credito"],
        "thresholds": {"reconciliation_tolerance": 0.0},
    }
    result = corte_santo_script.reconcile(terminal, sistema, config)

    assert result["status"] == "requires_review"
    assert result["by_group"]["bancos"]["difference"] == 50.0
    assert result["exceptions"][0]["exception_key"] == "payment_form_discrepancy_bancos"


def test_build_revision_document_shapes_client_format() -> None:
    result = corte_santo_script.run(BASE_INPUT, CONFIRMED_CONFIG)
    doc = result["workflow_run"]["revision_document"]

    assert doc["unidad"] == "SANTO"
    assert doc["formato_corte"] == "BIEN"
    assert doc["vta_al_dia"]["meta_vta"] == 64359.05
    # TOTAL = saldo_banorte - prov_utilidades when not explicitly provided.
    assert doc["saldos"]["total"] == 438379.26
    assert doc["falta_por_entrar"]["cxc"] == 11891.5
