# ADR-0023: Persist bank snapshots by covered bank dates

Date: 2026-07-24

## Context

Bank files are commonly uploaded after a weekend or after one or more missed
uploads. The previous watcher persisted the reconciliation only on the exact
workflow run selected by the operator. The dashboard treated that row as a
single global snapshot and looked only backward from the selected date. This
made a catch-up upload fail to represent the same bank state across all dates
covered by the bank files, and a later snapshot could change the meaning of
historical dates.

Recent production events also showed that the dashboard uploaded valid bank
files but could not dispatch GitHub Actions because its GitHub credential
returned `401 Bad credentials`.

## Decision

1. Each successful bank watcher run records `snapshot_business_date` and the
   `covered_business_dates` it filled after the previous bank snapshot.
2. A newly covered daily run receives that snapshot. A later bank upload does
   not overwrite a date that already has a newer snapshot; it only fills the
   next uncovered range.
3. Dashboard outstanding balances first select the snapshot whose covered
   dates contain the requested date. Only when there is no exact covered
   snapshot does it fall back to the latest prior snapshot and add newer Corte
   channels.
4. Bank filenames with an explicit ISO date are matched to the requested bank
   date. Files from another date cannot be paired accidentally.
5. The bank watcher runs on a schedule as a retry path. It discovers uploaded
   bank events whose processing did not complete, so a temporary dashboard
   dispatch failure does not permanently strand the upload.

## Consequences

Historical dashboard dates keep the bank snapshot that covered them, while a
weekend or missed-day upload can populate all newly covered dates in one run.
The scheduled fallback adds up to the configured schedule interval before a
stranded upload is retried. The dashboard GitHub token should still be
repaired for immediate dispatch; the scheduled path is the safety net rather
than the primary trigger.
