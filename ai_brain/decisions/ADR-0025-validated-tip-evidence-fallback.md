# ADR-0025: Validated tip evidence fallback

Date: 2026-07-27

## Decision

The Corte workflow may use AMEX or Bancarias photo tips only when that photo's
total reconciles with the Corte XLS within the configured tolerance. If the
photo total is inconsistent, the workflow must remain in `requires_review`
and use the validated `Cierre Sistema` tips as the provisional calculation.

## Rationale

An OCR extraction can return a plausible partial tip value while missing part
of a photographed bank report. Using that value produces a numerically neat
but incorrect daily propina. The XLS validation is the gate for trusting the
photo-derived amount; a mismatch must never silently replace the validated
payment-form totals.

## Consequences

- A mismatched bank photo still creates the evidence exception and requires
  review.
- The daily record keeps a complete, reproducible tip total instead of a
  partial OCR result.
- Dish courtesies remain part of efectivo, and `Propinas Efectivo` remains a
  separate adjustment unless the operating owner changes that rule.
