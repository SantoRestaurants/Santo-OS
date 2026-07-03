# ADR-0016: Corte CxC Lifecycle Ledger

Status: accepted

## Decision

CxC principal is recognized in the PayPal column on the opening business date.
Later settlement never recognizes that principal again. Only a newly known tip
is added on the settlement date. Cash settlement produces a zero PayPal delta.

The email body is authoritative for opening/settlement intent and movement ID.
CxC images support amounts, channel, account and tip. Each receivable is stored
in `corte_receivables` with a stable key; workflow JSON remains audit context.

## Evidence

The corrected June 2026 Ingresos workbook confirms:

- 2026-06-17: `2395-2395 = 0`; the new 359.25 tip enters Propinas.
- 2026-06-20: `245+3078-2565 = 758`; 245 is a new opening and 513 is a tip.
- 2026-06-22: `245-245 = 0` for a cash settlement.
- 2026-06-24, 27 and 29: opening principals enter PayPal once.

## Consequences

- Reprocessing an email cannot duplicate a movement-backed receivable.
- A settlement without a known opening becomes `requires_review`.
- OCR cannot decide lifecycle intent when the email body supplies it.
