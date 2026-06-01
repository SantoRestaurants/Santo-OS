# First Sprint Alignment

Source: recent client conversation shared on 2026-06-01.

## Sprint Framing

The first sprint is a foundation sprint, not full P0 completion.

The goal is to prove that the Santo AI OS foundation is well structured, safe, traceable, free of invented business assumptions and ready to connect real operational rules when Santo confirms them.

## Target Scope

- PR 1 through PR 4 complete and tested.
- PR 5 with Agent Mail core for intake, logging and safe classification.
- PR 6 intake only:
  - workflow_runs
  - documents
  - tasks
  - exceptions
  - events
  - `requires_review`

Do not build final Corte reconciliation logic until operational inputs are confirmed.

## Sprint Success Criteria

The sprint is successful if:

- The base flow works end-to-end with fixtures/synthetic data: input -> workflow_run -> documents/tasks/exceptions -> events/watchdog -> dashboard.
- Agent Mail records emails/attachments in an orderly way and does not guess ambiguous routing.
- Pending operational rules become `requires_review`, not `completed`.
- There is no hardcoding of Drive paths, thresholds, reviewers, restaurants, routing or business rules.
- RLS/security is designed from the start.
- Idempotency is demonstrated: running the same input twice does not duplicate or corrupt data.
- The dashboard makes it clear what happened, what is blocked and what needs review.
- The end of sprint has a clear list of what is ready, what is pending and what depends on Santo.

## Blocked Until Santo Inputs

- Corte thresholds and reconciliation criteria.
- Reviewer map by exception type.
- Drive URLs, hierarchy, permissions and naming.
- Restaurant/entity/RFC mappings and short codes.
- Definitive Agent Mail routing.
- Utility template rules and Sheets scope.
- Real anonymized/sanitized XML export fixtures.

## PR Notes Required

Each PR should include:

- what was done
- what remains pending
- how it was tested
- operational blockers

