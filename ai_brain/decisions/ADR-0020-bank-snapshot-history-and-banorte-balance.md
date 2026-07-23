# ADR-0020: Historical bank snapshots and Banorte balance persistence

Date: 2026-07-17

## Context

The bank watcher can process a date later than the date of the latest uploaded
statement. The 16 July Corte currently has no uploaded bank documents, so it
must not inherit the 15 July bank reconciliation or be marked as validated.
When a Corte does have a bank statement, same-day Banorte terminal deposits
are not eligible to settle that same day's sales: Banorte settles on the
following day. Independently, the scheduler only copied the statement's final
Banorte balance while iterating AMEX matches, so a Banorte-only batch could
also leave the latest workflow run without `saldos.banorte`.

The dashboard also used one latest outstanding snapshot for every selected
day. That erased the historical distinction between a day that had money
pending when it was processed and a later day that had already cleared it.

## Decision

- Persist the parsed Banorte final balance on every bank batch and on every
  day touched by that batch, independently of AMEX matching.
- Keep Banorte FIFO settlement eligibility strictly later-dated (`>`), in line
  with the next-day settlement rule.
- Persist exact bank-statement deposit identities and exclude deposits already
  consumed by the previous bank batch. This prevents cumulative statement
  files from settling the same Banorte residual twice.
- When explicitly reprocessing a date that already has a bank snapshot, add
  that date's current Corte ledger again before reconciling; do not reopen or
  rewrite earlier historical dates.
- Persist cumulative `falta_por_entrar_por_dia` values from the bank snapshot,
  not the sum of items originating on that date. A missing date means no bank
  evidence, while an explicit zero means the cumulative snapshot was clear.
- Persist the complete unmatched ledger in
  `bank_processing_snapshot.pending_items`. The next bank validation must
  reconcile that prior ledger together with only the newer Corte days; it must
  never start from the selected day's register alone.
- Persist the matching channel breakdown in
  `falta_por_entrar_detalle_por_dia`, so a historical total is never rendered
  with a newer batch's channel detail. The total-only field remains the
  backwards-compatible fallback for older payloads.
- Do not overwrite a prior date when a later bank batch is processed. Dates
  first processed together share the same cumulative snapshot.
- Resolve a day's display from the earliest bank snapshot on or after that
  business date, preferring an exact-date snapshot. This preserves historical
  values and lets days processed together share one snapshot.
- Keep the validation date as audit metadata only; the day views show the
  snapshot recorded for the selected business day and do not introduce a
  second date into that interaction.
- Read the bank validation badge from the selected run's explicit bank state.
  A missing bank snapshot produces a pending-upload state rather than using
  the latest global reconciliation.
- If the bank watcher reports missing statements for a date that still contains
  stale bank fields, the scheduler removes that date's reconciliation, snapshot,
  bank saldo and outstanding value, then persists `waiting_for_input`.

## Consequences

The dashboard no longer displays a guessed `$0` for days without bank data.
Older runs without the new metadata continue to use their persisted pending
items where available; future bank runs write the complete date metadata.
