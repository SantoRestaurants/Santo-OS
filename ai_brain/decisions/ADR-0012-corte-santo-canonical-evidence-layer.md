# ADR-0012: Corte Santo Canonical Evidence Layer

Date: 2026-06-12

## Status

Accepted.

## Context

The 35-page `Corte Santo.pdf` operating procedure shows that Corte Santo has
three distinct calculation stages:

1. reconcile terminal/platform evidence against Wansoft
2. transform validated values for the monthly Ingresos workbook
3. match bank collections and calculate amounts still pending

The prior parser represented the repeated cash comparison amount on the Corte
row labelled `Propina` as a real tip. That doubled cash during reconciliation.
Vision and Banorte parsers also existed as isolated components but were not
called by the primary workflow.

## Decision

- Add `evidence_builder.py` to produce a traceable canonical evidence package.
- Keep reconciliation inputs separate from monthly Ingresos registration
  values.
- Treat the duplicated cash value in the Corte template as a comparison/global
  value, not a cash tip.
- Apply dish courtesies to cash only in the Ingresos registration view.
- Apply the confirmed lower-tip rule when tira and bank-photo tips are both
  available.
- Compare AMEX and bank photo totals against the Corte Excel with configurable
  evidence tolerance.
- Integrate configured vision extraction and Banorte statement parsing into
  `script.run`.
- Any low-confidence extraction, unclassified deposit or evidence mismatch
  keeps the run in `requires_review`.

## Consequences

- The real 2026-06-04 Corte Excel no longer double-counts cash.
- Downstream workbook writers can consume a single canonical package without
  reinterpreting raw evidence.
- Full automation still requires AMEX statement parsing, pending-collection
  calculation, controlled workbook write-back, Drive storage and notification.
