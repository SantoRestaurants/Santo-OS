# ADR-0021: Recover legacy platform pending rows before bank matching

## Status

Accepted on 2026-07-22.

## Context

Older daily bank writes could persist only the newest Uber/Rappi pending item
inside `bank_reconciliation.pending_items`. The next bank watcher treated that
partial list as a cumulative snapshot, so an older still-open platform sale
could disappear from `Falta por entrar`. This occurred in the July 2026 SANTO
run when Rappi was first reduced from MXN 5,490 to MXN 3,030, while the
preceding legacy aggregate also proved that the 17 July MXN 1,050 row was
missing.

## Decision

When the latest payload has platform pending items but no explicit
`bank_processing_snapshot`, union older item-level Uber/Rappi rows that were
already persisted as pending. The current bank statement still decides whether
each recovered row is settled. If an explicit snapshot exists, it remains
authoritative and the recovery is skipped so settled rows are not revived.

If a legacy `bank_processing.pending_collections` total is larger than its
item-level rows, reconcile the exact gap against daily platform sales at that
processing cutoff. Do not choose an arbitrary row when no exact combination
exists.

## Consequences

- Legacy partial snapshots no longer erase previously recorded platform
  pending rows or exact aggregate-backed rows.
- Bank matching remains the source of settlement truth.
- The production correction is auditable and idempotent; a later real Rappi
  deposit can settle the recovered row normally.
