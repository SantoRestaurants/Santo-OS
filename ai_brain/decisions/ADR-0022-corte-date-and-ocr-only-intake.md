# ADR-0022: Preserve source Corte dates and keep intake OCR-first

Date: 2026-07-24

## Context

The Corte email for 2026-07-23 was received on 2026-07-24. Its main stage
could not start because the supporting `mal cobro` photo was not classified.
The intake attempted Gemini for that classification, received HTTP 429, and
then persisted the run with the current date because the stage did not yet
have a `workflow_result`. This made the 2026-07-23 run appear to be missing.

## Decision

1. Deterministic filename and local OCR signals classify intake evidence first.
2. `mal cobro` is retained as non-vision adjustment evidence and does not
   block the Corte stage.
3. The configured `local_ocr_fallback_to_vision` flag controls opaque-image
   classification as well as numeric extraction. Production remains OCR-only.
4. If stage 1 stops before producing a workflow result, the poller uses the
   source request payload date. It never substitutes the processing date for
   the business date.

## Consequences

Known Corte packages no longer depend on Gemini availability for intake
classification. An ambiguous opaque image remains `requires_review` instead
of being guessed. A missing source date also remains reviewable instead of
creating a misleading date-indexed run.
