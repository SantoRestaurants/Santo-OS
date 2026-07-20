# ADR-0022: Tip-total arithmetic validation

Date: 2026-07-20

## Status

Accepted.

## Context

The confirmed Corte rule selects the lower supported tip total when the Tira X
and bank evidence disagree. On 2026-07-16, OCR read the Tira X total as
MXN 1,557.70 while the Bancarias tip component alone was MXN 7,879.00. The
implementation treated both readings as supported and silently selected the
impossible lower value.

## Decision

- A Tira X tip total cannot be supported when it is below either individual
  AMEX or Bancarias tip component.
- In that case, use the independently supported AMEX + debit + credit tip sum
  for the income register and emit a high-severity `requires_review` exception.
- Keep the confirmed lower-tip rule when both totals pass this arithmetic
  invariant.

## Consequences

- OCR under-reads cannot silently replace a mathematically supported tip sum.
- The monthly workbook receives the supported value while the contradictory
  evidence remains visible for human review.
- No configurable monetary threshold is needed because the guard is an
  arithmetic invariant rather than a business tolerance.
