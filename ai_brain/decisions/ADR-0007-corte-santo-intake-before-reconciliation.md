# ADR-0007: Corte Santo Intake Before Reconciliation

Date: 2026-05-27

## Status

Accepted.

## Context

Corte Santo is the P0 primary workflow. PR 6 can start partially, but PR 7 reconciliation checks require confirmed thresholds, severities, mandatory attachments and reviewer map.

## Decision

Implement Corte Santo intake before reconciliation:

- Accept structured workflow input for one restaurant/date.
- Register document metadata.
- Prepare workflow_run, document, task, exception, event and watchdog records.
- Return `requires_review` for missing operational config or document hashes.
- Avoid final reconciliation, pass/fail decisions or threshold checks until PR 7 inputs are confirmed.

## Consequences

- The primary workflow now has a real module shape and test coverage.
- Agent Mail and the command handler can hand off Corte intake payloads safely.
- Reconciliation behavior remains blocked on confirmed Santo operational inputs instead of being guessed.
