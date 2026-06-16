# ADR-0013: Corte Santo Two-Stage Automation

Date: 2026-06-12

## Status

Accepted.

## Context

The operating owner clarified the workflow boundary described in
`Corte Santo.pdf`:

1. The Corte email arrives with photos and operating evidence. SantoOS
   reconciles it, writes the monthly Ingresos/Forecast workbooks, marks the
   loaded Ingresos cells yellow, and emails the supervisor.
2. The supervisor later uploads AMEX and Banorte statements to Drive. Their
   presence resumes the same workflow run. SantoOS matches expected collections
   against bank deposits, leaves legitimate unmatched expectations as pending,
   marks the validated Ingresos cells blue, updates REVISION, and emails the
   supervisor.

## Decision

- Keep both stages in the existing Corte Santo workflow.
- Use `waiting_for_input` with `waiting_reason=awaiting_bank_files` between
  stages.
- Add a Drive watcher that emits a shared `workflow.resume` command only after
  both AMEX and Banorte files are present.
- Use configured workbook layouts and stage colors; template columns are not
  implicit business assumptions.
- Initial workbook writes use yellow; bank-validated writes use blue.
- Bank matching is transaction-based. Legitimately pending expected
  collections remain in REVISION and do not fail bank validation.
- Missing Drive workbook IDs, notification credentials, layouts, evidence or
  ambiguous bank files return `requires_review`.

## Consequences

- The workflow now has executable contracts for the complete two-stage flow.
- Production activation still requires stable Drive credentials/file IDs,
  supervisor email and deployment of the pollers/runtime.
