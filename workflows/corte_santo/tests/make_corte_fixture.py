"""Generate a synthetic corte .xlsx fixture mirroring the client layout.

Run from the repo root:  python workflows/corte_santo/tests/make_corte_fixture.py
"""

from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "santo_corte_sample.xlsx"


def _matched_rows() -> list[list[object]]:
    rows: list[list[object]] = [[None] * 7 for _ in range(20)]

    # Cierre Ter/Pla block (terminals / platforms = real).
    rows[0] = ["Cierre Ter/Pla", "Amex", "Bancos", "Efectivo Real", "Transferencia", "Uber Eats", "Rappi"]
    rows[1] = ["Consumo", 2488.00, 28235.00, 670.00, 0.00, 1300.00, 880.00]
    rows[2] = ["Propina", 373.20, 3904.27, 670.00, 0.00, 0.00, 0.00]
    rows[3] = ["Global", 2861.20, 32139.27, 1340.00, 0.00, 1300.00, 880.00]

    # Cierre Sistema block (Wansoft POS).
    rows[6] = ["Cierre Sistema", "Amex", "T Debito", "T Credito", "Total Bancos", "Efectivo Sistema", "Uber Eats", "Rappi"]
    rows[7] = ["Consumo", 2488.00, 9217.50, 19017.50, 28235.00, 670.00, 1300.00, 880.00]
    rows[8] = ["Propina", 373.20, 1366.64, 2537.63, 3904.27, 670.00, 0.00, 0.00]
    rows[9] = ["Global", 2861.20, 10584.14, 21555.13, 32139.27, 1340.00, 1300.00, 880.00]

    return rows


def main() -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "CORTE"
    for row in _matched_rows():
        ws.append(row)
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    wb.save(FIXTURE)
    print(f"wrote {FIXTURE}")


if __name__ == "__main__":
    main()
