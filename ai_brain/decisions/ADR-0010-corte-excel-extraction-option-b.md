# ADR-0010: Corte Excel Extraction (Option B)

Date: 2026-06-11

## Status

Accepted. Builds on ADR-0009.

## Context

The corte arrives by email as PDFs, photos and Excel workbooks (per the client
workflow walkthrough). ADR-0009 reconciles by payment form but expected the
`cierre_terminal` / `cierre_sistema` figures already structured in the payload.
The client asked to automate the extraction of those figures from the corte
Excel ("SANTO CORTE ...xlsx") rather than capturing them by hand.

P0 confirmed inputs at this point: reconciliation tolerance = 0 and the only
active unit is SANTO.

## Decision

1. Add `workflows/corte_santo/corte_excel_parser.py`: a read-only, `data_only`
   openpyxl parser that locates the "Cierre Ter/Pla" and "Cierre Sistema"
   anchors and reads the Consumo/Propina rows per column, mapping each column
   header to a reconciliation group via config (`excel_layout`). A confirmed
   default layout is shipped.
2. Wire it into `script.run`: when structured `cierre_terminal`/`cierre_sistema`
   are not supplied and a `corte_excel`/`daily_sales_report` document carries a
   `source_path`, extract the figures and reconcile.
3. Safety: any column header the parser cannot confidently map (or a missing
   file / missing openpyxl) becomes a warning that raises an
   `extraction_requires_review` exception and forces `requires_review`. Money is
   never silently dropped or miscounted; uncertainty never becomes `completed`.
4. Standardize `payment_forms` on the report groups (amex, bancos, efectivo,
   transferencia, plataformas) so the parser output, the reconciliation and the
   client "Diferencias" row all line up. Updated config, fixtures and tests.

## Consequences

- Corte figures can be produced automatically from the uploaded Excel, removing
  the manual capture step for the happy path.
- New optional dependency: `openpyxl` (already present in the environment).
  Absence degrades safely to `requires_review`.
- The exact production column headers per unit still need Santo confirmation so
  the default `column_label_map` matches real files; mismatches surface as
  `requires_review` rather than silent errors.
- Reading photos/PDFs (terminal tickets, bank statements) for the "Falta por
  entrar en la cuenta" amounts remains out of scope; those stay as payload
  input pending a separate decision.
- AI still performs no bank/SAT/payroll/portal actions; this is local parsing
  and validation only.
