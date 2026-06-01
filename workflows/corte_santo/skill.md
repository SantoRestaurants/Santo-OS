# Corte Santo Skill

P0 primary workflow: Corte Santo - Daily Sales Reconciliation.

## Scope

This module handles PR 6 partial intake only:

- Accept one restaurant/unit and business date.
- Register submitted documents/evidence.
- Prepare workflow_run, document, task, exception, event and watchdog records.
- Return `requires_review` when config or required inputs are missing.

## Non-Scope

This module does not perform final reconciliation checks yet. PR 7 requires confirmed thresholds, severities and reviewer map.

## Safety

AI may classify, validate and summarize intake state.

AI must not autonomously execute bank, SAT, payroll, legal, fiscal or government-portal actions.
