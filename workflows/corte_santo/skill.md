# Corte Santo Skill

P0 primary workflow: Corte Santo - Daily Sales Reconciliation.

## Scope

This module covers daily reconciliation for one restaurant/unit and date:

- Accept structured intake (one restaurant/unit + business date) and register
  submitted documents/evidence.
- **Option B automation:** when the corte figures are not supplied as structured
  data, extract "Cierre Ter/Pla" and "Cierre Sistema" directly from the uploaded
  corte Excel (`document_type` `corte_excel` or `daily_sales_report` with a
  `source_path`). See `corte_excel_parser.py`.
- Reconcile the day by payment form (forma de pago): compare `cierre_terminal`
  ("Cierre Ter/Pla", what terminals and delivery platforms reported) against
  `cierre_sistema` ("Cierre Sistema", what the Wansoft POS recorded).
- Compare grand totals: `Total Real` must equal `Total Sistema` within the
  confirmed tolerance.
- Build the structured `REVISION` report document the client stores in Drive.
- Prepare workflow_run, document, task, exception, event and watchdog records.
- Return `requires_review` when config or required inputs are missing, when any
  document lacks a `source_hash`, when the Excel parser cannot confidently map a
  column, or when a payment-form / total discrepancy exceeds the confirmed
  tolerance.

## Excel Extraction (Option B)

`corte_excel_parser.py` reads the workbook read-only (`data_only`, no macros) and
maps each column header to a reconciliation group via config (`excel_layout`).
A confirmed default layout is shipped. Any header it cannot map produces an
`unmapped_column` warning, which raises an `extraction_requires_review`
exception and keeps the run in `requires_review` — money is never silently
dropped or miscounted. Requires the `openpyxl` dependency; if absent, the run
returns `requires_review` with an `openpyxl_not_available` warning.

## Reconciliation Model

The real Santo process is multi-form, not a single sales-vs-deposit check:

- Payment forms are confirmed via config (`payment_forms`): typically Amex,
  Banorte debit, Banorte credit, efectivo, transferencia, Uber Eats, Rappi,
  PayPal.
- Each form carries `consumo` and `propina`; `global = consumo + propina`.
- Forms roll up into the report columns (Amex / Bancos / Efectivo /
  Transferencia / Plataformas) for the `Diferencias` row.
- A difference above `thresholds.reconciliation_tolerance` (per group or on the
  Total Real vs Total Sistema) creates a `reconciliation_discrepancy` exception.

## REVISION Document

`build_revision_document` mirrors the client format per unit: VTA POR DIA,
VTA AL DIA, VTA META DEL MES, FORMATO DE CORTE, SALDOS (prov. aguinaldos,
saldo Banorte, prov. utilidades, total), INGRESOS / GASTOS ADICIONALES, FALTA
POR ENTRAR EN LA CUENTA (cobros Amex/Uber/Rappi/PayPal/Banorte/CXC) and
AJUSTES DEL DIA (descuentos, anulaciones, cancelaciones).

## Config Dependencies (pending confirmation)

`restaurant_map`, `drive_folder_map`, `mandatory_attachments`, `reviewer_map`,
`payment_forms` and `thresholds.reconciliation_tolerance` must be confirmed by
Santo. No unit code, account, payment form, threshold or reviewer is hardcoded.

## Safety

AI may classify, validate, reconcile and summarize the corte and draft the
REVISION document.

AI must not autonomously execute bank, SAT, payroll, legal, fiscal or
government-portal actions. Uncertainty never becomes `completed`; missing config
or inputs return `requires_review`.
