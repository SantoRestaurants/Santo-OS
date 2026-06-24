from __future__ import annotations

import importlib.util
from datetime import datetime
from pathlib import Path

from openpyxl.comments import Comment
from openpyxl import Workbook, load_workbook


ROOT = Path(__file__).resolve().parents[1]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


writer = _load("workbook_writer")
bank = _load("bank_reconciliation")
pipeline = _load("two_stage_pipeline")
runtime = _load("runtime")


def _ingresos(path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws["B5"] = datetime(2026, 6, 4)
    wb.save(path)


def _ingresos_with_formula_dates(path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws["B5"] = datetime(2026, 6, 1)
    ws["B6"] = "=+B5+1"
    ws["B7"] = "=+B6+1"
    ws["B8"] = "=+B7+1"
    wb.save(path)


def _forecast(path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws["C4"] = datetime(2026, 6, 4)
    ws["C38"] = "TOTAL MES"
    wb.save(path)


def _forecast_stale_projection_month(path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    for day in range(1, 31):
        row = day + 3
        ws.cell(row, 3).value = datetime(2026, 5, day)
        ws.cell(row, 4).value = day * 1000
    ws["C38"] = "TOTAL MES"
    wb.save(path)


VALUES = {
    "amex": 9909.45,
    "debito": 5130.25,
    "credito": 52061.9,
    "efectivo": 5138.5,
    "paypal": 0,
    "uber": 3525,
    "rappi": 0,
    "propinas": 6582.6,
}
INGRESOS_LAYOUT = {
    "date_column": 2,
    "columns": {"amex": "C", "debito": "D", "credito": "E", "efectivo": "F", "paypal": "H", "uber": "J", "rappi": "L", "propinas": "R"},
    "stage_colors": {"corte_loaded": writer.YELLOW, "bank_validated": writer.BLUE},
}
FORECAST_LAYOUT = {
    "date_column": 3,
    "venta_real_column": "E",
    "total_month_label_column": "C",
    "total_month_label": "TOTAL MES",
    "subtotal_columns": ["D", "E", "F"],
    "data_start_row": 4,
    "data_end_row": 34,
}


def test_ingresos_moves_from_yellow_to_blue(tmp_path: Path) -> None:
    source = tmp_path / "ingresos.xlsx"
    yellow = tmp_path / "yellow.xlsx"
    blue = tmp_path / "blue.xlsx"
    _ingresos(source)

    first = writer.write_ingresos(str(source), str(yellow), "2026-06-04", VALUES, dry_run=False, layout=INGRESOS_LAYOUT)
    second = writer.write_ingresos(
        str(yellow), str(blue), "2026-06-04", VALUES, stage="bank_validated", dry_run=False, layout=INGRESOS_LAYOUT
    )

    assert first["status"] == "written"
    assert second["status"] == "written"
    assert load_workbook(yellow).active["C5"].fill.fgColor.rgb == writer.YELLOW
    assert load_workbook(blue).active["C5"].fill.fgColor.rgb == writer.BLUE


def test_ingresos_finds_cached_formula_date_rows(tmp_path: Path) -> None:
    source = tmp_path / "ingresos-formulas.xlsx"
    output = tmp_path / "ingresos-output.xlsx"
    _ingresos_with_formula_dates(source)

    result = writer.write_ingresos(
        str(source), str(output), "2026-06-04", VALUES, dry_run=False, layout=INGRESOS_LAYOUT
    )

    assert result["status"] == "written"
    assert load_workbook(output).active["C8"].value == VALUES["amex"]


def test_ingresos_preserves_red_paypal_adjustment_comment(tmp_path: Path) -> None:
    source = tmp_path / "ingresos-paypal-comment.xlsx"
    output = tmp_path / "ingresos-paypal-output.xlsx"
    _ingresos(source)
    wb = load_workbook(source)
    ws = wb.active
    ws["H5"] = "=2395-2395"
    ws["H5"].fill = writer.PatternFill("solid", fgColor=writer.RED)
    ws["H5"].comment = Comment("Mov 89109 $2395 con propina de $359.25 del sr. Toro", "None")
    wb.save(source)
    wb.close()

    result = writer.write_ingresos(
        str(source),
        str(output),
        "2026-06-04",
        VALUES,
        stage="bank_validated",
        dry_run=False,
        layout=INGRESOS_LAYOUT,
    )

    assert result["status"] == "written"
    ws_out = load_workbook(output).active
    assert ws_out["H5"].value == "=2395-2395"
    assert ws_out["H5"].fill.fgColor.rgb == writer.RED
    assert "propina de $359.25" in ws_out["H5"].comment.text


def test_ingresos_writes_cxc_paypal_comment_when_note_is_supplied(tmp_path: Path) -> None:
    source = tmp_path / "ingresos-paypal-note.xlsx"
    output = tmp_path / "ingresos-paypal-note-output.xlsx"
    _ingresos(source)

    result = writer.write_ingresos(
        str(source),
        str(output),
        "2026-06-04",
        VALUES,
        stage="corte_loaded",
        dry_run=False,
        layout=INGRESOS_LAYOUT,
        cell_notes={
            "paypal": {
                "kind": "cxc",
                "amount": 6714.0,
                "formula": "=6714-6714",
                "comment": "CXC\nMOV 87745 $1,695\nTOTAL $6714\n======",
            }
        },
    )

    assert result["status"] == "written"
    ws_out = load_workbook(output).active
    assert ws_out["H5"].value == "=6714-6714"
    assert ws_out["H5"].fill.fgColor.rgb == writer.RED
    assert "MOV 87745" in ws_out["H5"].comment.text


def test_ingresos_updates_existing_paypal_note_when_note_is_supplied(tmp_path: Path) -> None:
    source = tmp_path / "ingresos-paypal-existing-note.xlsx"
    output = tmp_path / "ingresos-paypal-existing-note-output.xlsx"
    _ingresos(source)
    wb = load_workbook(source)
    ws = wb.active
    ws["H5"] = "=245-245"
    ws["H5"].fill = writer.PatternFill("solid", fgColor=writer.RED)
    ws["H5"].comment = Comment("old OCR note", "SantoOS")
    wb.save(source)
    wb.close()

    result = writer.write_ingresos(
        str(source),
        str(output),
        "2026-06-04",
        VALUES,
        stage="corte_loaded",
        dry_run=False,
        layout=INGRESOS_LAYOUT,
        cell_notes={
            "paypal": {
                "kind": "cxc",
                "amount": 245.0,
                "formula": "=245-245",
                "comment": "CXC\nPago en efectivo de CXC: $245.00\n======",
            }
        },
    )

    assert result["status"] == "written"
    ws_out = load_workbook(output, data_only=False).active
    assert ws_out["H5"].value == "=245-245"
    assert "Pago en efectivo de CXC" in ws_out["H5"].comment.text


def test_ingresos_writes_paypal_value_with_cxc_note(tmp_path: Path) -> None:
    source = tmp_path / "ingresos-paypal-value-note.xlsx"
    output = tmp_path / "ingresos-paypal-value-note-output.xlsx"
    _ingresos(source)
    values = {**VALUES, "paypal": 513.0}

    result = writer.write_ingresos(
        str(source),
        str(output),
        "2026-06-04",
        values,
        stage="corte_loaded",
        dry_run=False,
        layout=INGRESOS_LAYOUT,
        cell_notes={
            "paypal": {
                "kind": "cxc",
                "amount": 513.0,
                "formula": "=3078-2565",
                "comment": "CXC\nCXC MESERO MOV 89972 $245\nPAGO CXC MOV 87028 TRANSFERENCIA\n======",
            }
        },
    )

    assert result["status"] == "written"
    ws_out = load_workbook(output, data_only=False).active
    assert ws_out["H5"].value == "=3078-2565"
    assert ws_out["H5"].fill.fgColor.rgb == writer.YELLOW
    assert "MOV 89972 $245" in ws_out["H5"].comment.text


def test_forecast_write_updates_total_month_formula(tmp_path: Path) -> None:
    source = tmp_path / "forecast.xlsx"
    output = tmp_path / "forecast-output.xlsx"
    _forecast(source)

    result = writer.write_forecast(str(source), str(output), "2026-06-04", 75685.1, dry_run=False, layout=FORECAST_LAYOUT)

    ws = load_workbook(output, data_only=False).active
    assert result["status"] == "written"
    assert ws["E4"].value == 75685.1
    assert ws["E38"].value == "=+SUBTOTAL(9,E4:E34)"


def test_forecast_rebases_confirmed_projection_month(tmp_path: Path) -> None:
    source = tmp_path / "forecast-stale-month.xlsx"
    output = tmp_path / "forecast-june.xlsx"
    _forecast_stale_projection_month(source)
    layout = {**FORECAST_LAYOUT, "allow_projection_month_rebase": True}

    result = writer.write_forecast(
        str(source), str(output), "2026-06-04", 75685.1, dry_run=False, layout=layout
    )

    ws = load_workbook(output, data_only=False).active
    assert result["status"] == "written"
    assert ws["C4"].value == datetime(2026, 6, 1)
    assert ws["C33"].value == datetime(2026, 6, 30)
    assert ws["D7"].value == 4000
    assert ws["E7"].value == 75685.1


def test_amex_named_columns_are_parsed() -> None:
    result = bank.parse_amex_rows(
        [
            ["metadata"],
            ["Fecha de pago", "Monto del pago"],
            ["2026-06-05", "9,500.25"],
        ]
    )
    assert result["status"] == "ok"
    assert result["total_expected"] == 9500.25


def test_bank_matching_allows_legitimate_pending_collections() -> None:
    result = bank.reconcile_bank_stage(
        [{"channel": "amex", "amount": 100.0}, {"channel": "amex", "amount": 50.0}],
        {
            "status": "ok",
            "deposits": [{"source": "amex", "amount": 100.0}],
            "domiciled_expenses": [],
        },
        {"status": "ok", "payments": []},
    )
    assert result["status"] == "bank_validated"
    assert result["pending_collections"]["amex"] == 50.0


def test_bank_matching_groups_amex_payments_by_expected_payment_date() -> None:
    result = bank.reconcile_bank_stage(
        [
            {"channel": "amex", "amount": 18437.66, "source_date": "12/6/2026", "expected_payment_date": "17/6/2026"},
            {"channel": "amex", "amount": 62832.78, "source_date": "13/6/2026", "expected_payment_date": "17/6/2026"},
            {"channel": "amex", "amount": 37299.77, "source_date": "14/6/2026", "expected_payment_date": "17/6/2026"},
            {"channel": "amex", "amount": 689.89, "source_date": "14/6/2026", "expected_payment_date": "17/6/2026"},
            {"channel": "amex", "amount": 94.47, "source_date": "12/6/2026", "expected_payment_date": "17/6/2026"},
            {"channel": "amex", "amount": 7467.54, "source_date": "14/6/2026", "expected_payment_date": "17/6/2026"},
            {"channel": "amex", "amount": 24309.8, "source_date": "14/6/2026", "expected_payment_date": "17/6/2026"},
        ],
        {
            "status": "ok",
            "deposits": [{"source": "amex", "amount": 151131.91, "operation_date": "17/06/2026"}],
            "domiciled_expenses": [],
        },
        {"status": "ok", "payments": []},
    )
    assert result["status"] == "bank_validated"
    assert result["pending_collections"] == {}
    assert result["matches"][0]["expected_group"][0]["amount"] == 18437.66


def test_initial_stage_waits_for_bank_files() -> None:
    result = pipeline.initial_stage_result(
        {"status": "ready_for_approval", "workflow_run": {"business_date": "2026-06-04"}},
        {"status": "written"},
        {"status": "written"},
        "developer@santorestaurants.com",
    )
    assert result["status"] == "waiting_for_input"
    assert result["waiting_reason"] == "awaiting_bank_files"
    assert result["notification"]["status"] == "ready_to_send"


def test_runtime_does_not_notify_or_update_when_stage_requires_review(monkeypatch) -> None:
    attempted = []
    monkeypatch.setattr(runtime, "send_notification", lambda *args, **kwargs: attempted.append("mail"))
    monkeypatch.setattr(runtime, "replace_document_content", lambda *args, **kwargs: {"status": "updated", "attempted": "drive"})

    result = runtime._deliver_and_update(
        {
            "status": "requires_review",
            "notification": {"to": "developer@santorestaurants.com"},
            "ingresos_write": {"output_path": "/tmp/ingresos.xlsx"},
        },
        {"drive_file_ids": {"ingresos": "file-id"}},
        False,
        required_drive_keys=("ingresos",),
    )

    # Notifications should not be attempted when status is requires_review
    assert "mail" not in attempted
    assert result["notification_delivery"]["status"] == "not_attempted"
    assert result["notification_delivery"]["reason"] == "stage_requires_review"
    # Drive updates should still happen (uploaded even with requires_review)
    assert len(result["drive_updates"]) == 1


def test_runtime_requires_drive_workbook_ids() -> None:
    result = runtime._deliver_and_update(
        {
            "status": "waiting_for_input",
            "notification": {"to": "developer@santorestaurants.com", "subject": "Corte", "text": "Listo"},
        },
        {},
        False,
        required_drive_keys=("ingresos", "forecast"),
    )

    assert result["status"] == "requires_review"
    assert result["requires_review_reason"] == "drive_workbook_ids_missing"
    assert result["missing_drive_keys"] == ["ingresos", "forecast"]


def test_runtime_dry_run_allows_missing_drive_workbook_ids() -> None:
    result = runtime._deliver_and_update(
        {
            "status": "waiting_for_input",
            "notification": {"to": "developer@santorestaurants.com", "subject": "Corte", "text": "Listo"},
        },
        {},
        True,
        required_drive_keys=("ingresos", "forecast"),
    )

    assert result["status"] == "waiting_for_input"
    assert result["missing_drive_keys"] == ["ingresos", "forecast"]
    assert result["drive_updates"] == []
    assert result["notification_delivery"]["status"] == "ready_to_send"


def test_runtime_downgrades_when_drive_update_fails(tmp_path: Path, monkeypatch) -> None:
    output = tmp_path / "ingresos.xlsx"
    output.write_bytes(b"verified")
    monkeypatch.setattr(
        runtime,
        "replace_document_content",
        lambda *args, **kwargs: {"status": "requires_review", "requires_review_reason": "credentials_missing"},
    )

    result = runtime._deliver_and_update(
        {
            "status": "completed",
            "notification": {"to": "developer@santorestaurants.com", "subject": "Corte", "text": "Listo"},
            "ingresos_write": {"status": "written", "output_path": str(output)},
        },
        {"drive_file_ids": {"ingresos": "file-id"}},
        True,
        required_drive_keys=("ingresos",),
    )

    assert result["status"] == "requires_review"
    assert result["requires_review_reason"] == "drive_workbook_update_failed"
