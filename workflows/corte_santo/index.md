# Corte Santo Workflow Index

## Purpose

P0 primary workflow for Santo daily sales reconciliation. It receives Agent Mail
or command-handler intake, extracts corte evidence, reconciles payment forms,
writes review artifacts, and waits for bank-stage validation when required.

## Load First

1. `skill.md` - scope, safety boundaries and required config.
2. `config.example.json` - configuration contract and confirmation placeholders.
3. `script.py` - primary workflow entry point.
4. `runtime.py` and `two_stage_pipeline.py` - live two-stage orchestration.
5. `docs/04_workflows/corte_santo_operating_procedure.md` - operating procedure interpretation.

## Supporting Files

- `corte_excel_parser.py` extracts Cierre Ter/Pla and Cierre Sistema from the corte workbook.
- `evidence_builder.py` normalizes canonical evidence for reconciliation and Ingresos.
- `vision_extractor.py` extracts AMEX, Bancarias and CXC evidence through local OCR and optional model fallback.
- `bank_statement_parser.py` parses AMEX and Banorte files.
- `bank_reconciliation.py` matches expected collections against bank deposits.
- `workbook_writer.py` updates controlled Ingresos, Forecast and REVISION workbooks.
- `fixtures/` and `tests/` hold the workflow contract examples and regression tests.

## Notes

Missing confirmed config or ambiguous evidence must return `requires_review`.
Do not add one-off scripts outside the shared workflow and command-handler path.
