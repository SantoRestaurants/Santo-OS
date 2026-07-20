# ADR-0021 — CXC email authority and bank-validated settlements

Date: 2026-07-20

## Status

Accepted.

## Context

The July 18 and July 19 Corte runs exposed two unsafe behaviors: a single email
sentence with multiple CXC movements was parsed as one event, and OCR-derived
amounts could overwrite the lifecycle intent and principal stated in the email.
Transfer settlements were also capable of closing a receivable before the bank
statement confirmed the deposit.

## Decision

- The deterministic email-body parser is authoritative for CXC lifecycle intent,
  movement IDs, principal amounts, and payment medium.
- One CXC sentence may create multiple itemized events.
- Vision/OCR may enrich settlement tips and supporting notes, but cannot replace
  authoritative email events or re-recognize settled principal as income.
- A transfer or card settlement is stored as pending evidence while the
  receivable remains open. Only bank reconciliation may increase
  `settled_principal` or close the row.
- Superseded itemized rows may resolve to exactly one named manual aggregate.
  Missing or ambiguous mappings require review.
- CXC bank sources and partial FIFO settlement rules are configuration-driven.

## Consequences

The Corte stage cannot reduce CXC merely because a payment was reported by
email. Bank reconciliation applies exact or partial validated deposits to the
ledger, and repeated processing remains idempotent by movement ID and deposit
identity.
