# ADR-0019: Bank settlement rules for the outstanding ledger

## Status

Accepted on 2026-07-13.

## Context

`Falta por entrar` is a gross, source-date ledger built from daily Corte sales.
The bank statement contains different settlement shapes: AMEX pays a documented
net batch on a known date, Banorte terminal settlements may arrive in several
rows and partially cover a Corte day, and Uber/Rappi pay net weekly amounts that
cannot be compared directly with gross daily sales.

The prior exact-amount-only implementation kept already deposited AMEX batches
pending, could not reduce a partially deposited Banorte day, and never closed
platform sales when commissions made the payout differ from the Corte gross.

## Decision

- AMEX is matched by its export batch and expected payment date. The Corte gross
  remains the user-facing balance; the export net is used only for the Banorte
  deposit match. A persisted pending label never prevents a later bank match.
- Banorte terminal deposits are applied FIFO only to Corte rows from an earlier
  business date. Partial application creates an auditable residual row.
- An Uber or Rappi payout closes open gross platform rows dated before the payout.
  Same-day sales remain open for the next settlement cycle.
- Commission-credit rows identified by configured DCC keywords remain traced but
  are excluded from operational deposits and do not create a review exception.
- All modes live under `bank_settlement_rules`; production uses the confirmed
  configuration rather than implicit dashboard behavior.

## Consequences

- New Corte days continue to enter the ledger once.
- Later bank statements remove or reduce older items instead of rebuilding them.
- `pending_items` can contain a Banorte `parcialmente_depositado` row with
  `original_amount`, `settled_amount` and the true residual.
- Platform payout coverage is date-based; if Santo changes payout cadence, the
  confirmed settlement configuration and tests must be updated together.
