from __future__ import annotations

import importlib.util
from pathlib import Path


WORKFLOW_DIR = Path(__file__).resolve().parents[1]
PARSER_PATH = WORKFLOW_DIR / "corte_excel_parser.py"
SCRIPT_PATH = WORKFLOW_DIR / "script.py"
FIXTURE_XLSX = WORKFLOW_DIR / "fixtures" / "santo_corte_sample.xlsx"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


parser = _load("corte_excel_parser", PARSER_PATH)
script = _load("corte_santo_script", SCRIPT_PATH)


CONFIG = {
    "workflow_key": "corte_santo_daily_sales_reconciliation",
    "restaurant_map": {"santo": {"display_name": "SANTO"}},
    "drive_folder_map": {"santo": "drive-folder-1"},
    "mandatory_attachments": ["corte_excel"],
    "reviewer_map": {"default": "admin_ops"},
    "payment_forms": ["amex", "bancos", "efectivo", "transferencia", "plataformas"],
    "thresholds": {"reconciliation_tolerance": 0.0},
}


def test_parse_workbook_rows_maps_groups() -> None:
    rows = [
        ["Cierre Ter/Pla", "Amex", "Bancos", "Efectivo Real"],
        ["Consumo", 2488.0, 28235.0, 670.0],
        ["Propina", 373.2, 3904.27, 670.0],
        [None, None, None, None],
        [None, None, None, None],
        [None, None, None, None],
        ["Cierre Sistema", "Amex", "Bancos", "Efectivo Sistema"],
        ["Consumo", 2488.0, 28235.0, 670.0],
        ["Propina", 373.2, 3904.27, 670.0],
    ]
    result = parser.parse_corte_workbook(rows, {})

    assert result["warnings"] == []
    assert result["cierre_terminal"]["amex"] == {"consumo": 2488.0, "propina": 373.2}
    assert result["cierre_terminal"]["bancos"]["consumo"] == 28235.0
    assert result["cierre_sistema"]["bancos"]["consumo"] == 28235.0


def test_unmapped_column_produces_warning() -> None:
    rows = [
        ["Cierre Ter/Pla", "Amex", "Criptomoneda"],
        ["Consumo", 2488.0, 999.0],
        ["Propina", 373.2, 0.0],
    ]
    result = parser.parse_corte_workbook(rows, {})

    assert any(w.startswith("unmapped_column:") for w in result["warnings"])


def test_parse_real_xlsx_fixture() -> None:
    result = parser.parse_corte_excel(str(FIXTURE_XLSX), {})

    assert result["warnings"] == []
    assert result["cierre_terminal"]["bancos"]["consumo"] == 28235.0
    assert result["cierre_sistema"]["bancos"]["consumo"] == 28235.0


def test_run_extracts_from_excel_and_reconciles() -> None:
    payload = {
        "business_date": "2026-04-14",
        "restaurant_key": "santo",
        "documents": [
            {
                "document_key": "corte_excel",
                "document_type": "corte_excel",
                "source_system": "agent_mail",
                "source_uri": "email://msg/corte.xlsx",
                "source_path": str(FIXTURE_XLSX),
                "source_hash": "hash-xlsx",
            }
        ],
    }
    result = script.run({"dry_run": True, "payload": payload}, CONFIG)

    assert result["status"] == "ready_for_approval"
    recon = result["workflow_run"]["reconciliation"]
    assert recon["totals"]["total_real"] == recon["totals"]["total_sistema"]
    assert any(t["task_key"] == "extract_corte_excel" for t in result["tasks"])


def test_run_missing_file_requires_review() -> None:
    payload = {
        "business_date": "2026-04-14",
        "restaurant_key": "santo",
        "documents": [
            {
                "document_key": "corte_excel",
                "document_type": "corte_excel",
                "source_system": "agent_mail",
                "source_uri": "email://msg/corte.xlsx",
                "source_path": "does/not/exist.xlsx",
                "source_hash": "hash-xlsx",
            }
        ],
    }
    result = script.run({"dry_run": True, "payload": payload}, CONFIG)

    assert result["status"] == "requires_review"
    assert any(
        e["exception_type"] == "extraction_requires_review" for e in result["exceptions"]
    )
