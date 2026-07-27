# ADR-0024: Bank snapshot visibility and operational alert cleanup

Date: 2026-07-27

## Decision

The dashboard may calculate and display an outstanding bank amount only when a
bank reconciliation snapshot explicitly covers the selected business date.
It must not reuse the latest earlier snapshot or carry forward newer Corte
channels for a date whose bank files are not loaded.

Operational intake, trigger-failure, correction and repair notifications are
not user-facing alerts. They are removed from the visible logs and review
surfaces, and stale records of those types may be cleaned from the operational
tables. Bank upload audit events and the supervisor approval record remain
available because they are functional controls for the bank stage.

## Consequences

- Friday, Saturday and Sunday can remain blank until a bank batch covering
  those dates is uploaded.
- A selected day with no bank snapshot shows that banks are not loaded rather
  than presenting a potentially misleading amount.
- The approval gate is preserved even though its internal review record is no
  longer shown as a dashboard alert.
