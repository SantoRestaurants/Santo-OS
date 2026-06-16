# Corte Santo Operating Procedure

## Authority

Primary operating source: `docs/04_workflows/source/Corte Santo.pdf`

Original supplied path: `C:\Users\dchac\Downloads\Corte Santo.pdf`

- Source date observed: 2026-06-11.
- Length: 35 pages.
- SHA-256:
  `7EB70395F6AE24DBB6B93CE80DB5FA29B0A2398EDA2079AD3BE31325B318A04A`.
- This document is the implementation-oriented interpretation of the PDF.
- When code, handoff notes and this procedure disagree, review the PDF and
  return `requires_review` until the operating owner confirms the rule.

## End-To-End Stages

1. Receive the daily Corte email and verify all required attachments.
2. Register and store the evidence for the restaurant and business date.
3. Validate terminal/platform evidence against the Corte Excel.
4. Validate Wansoft evidence against the `Cierre Sistema` block.
5. Reconcile `Total Real` against `Total Sistema` with tolerance zero.
6. Register the validated day in the monthly Ingresos workbook.
7. Register Venta Bruta in the monthly Forecast workbook and extend subtotal
   formulas when required.
8. Build the REVISION summary with the current and following day.
9. Review Banorte and AMEX statements and calculate collections still pending.
10. Register additional income and domiciled/additional expenses.
11. Save/share the final REVISION output and send the validation notification.

## Runtime State Machine

### Stage 1: Corte Load

`Agent Mail -> reconcile -> write Ingresos yellow -> write Forecast -> update
Drive -> notify supervisor -> waiting_for_input(awaiting_bank_files)`

### Stage 2: Bank Validation

`Drive watcher detects AMEX + Banorte -> workflow.resume -> match expected
collections -> update pending collections/REVISION -> mark Ingresos blue ->
update Drive -> notify supervisor -> completed`

## Confirmed Calculation Rules

### Reconciliation

- AMEX and Banorte terminal amounts must match their physical/digital evidence.
- `Cierre Sistema` must match Wansoft by payment form.
- `Total Real` must equal `Total Sistema`; any difference requires review.
- The repeated cash amount on the Corte rows labelled `Propina` is the cash
  comparison/global amount, not a cash tip. It must not be counted twice.

### Monthly Ingresos Registration

- Register gross amounts by channel in the corresponding date row.
- Record tips separately in column R.
- Tips are AMEX + debit + credit tips only.
- Use the lower tip total when tira and bank evidence disagree.
- Add dish courtesies to cash for the monthly Ingresos registration.
- The resulting Venta Bruta must match the Wansoft global sales evidence.

### Forecast And REVISION

- Write the validated Venta Bruta into Forecast for the correct date.
- The supplied monthly Forecast can contain the correct projection amounts with
  stale prior-month dates. When `allow_projection_month_rebase` is confirmed,
  a complete consecutive day-1-through-day-N projection series is rebased onto
  the Corte month without changing its projection amounts.
- Extend subtotal formulas when a new row/date falls outside the prior range.
- The REVISION summary includes the reviewed day and next day reference.
- Thursday preparation includes the Thursday-through-Sunday goal horizon.

### Bank Collections

- Banorte deposits are identified by `REST SANTO HAND ROLL`.
- AMEX deposits are identified by the detailed SPEI description and crossed
  against AMEX `Monto del pago` and `Fecha de pago`.
- Banorte usually settles the following day.
- AMEX usually settles in 3-5 days.
- Uber settles Mondays for the preceding Monday-Sunday period.
- Rappi settles Fridays for the applicable weekly period.
- CXC is included only when Wansoft identifies a CXC.
- Unclassified deposits or uncertain matches require review.

### Additional Activity

- Additional income includes client transfers and other non-recurring income.
- Additional expenses include domiciled charges such as cards, internet,
  Amazon and Spotify.

## Automation Completion Gate

The Corte Santo workflow is completely automated only when one real daily email
can safely produce all of the following without manual data entry:

- classified intake and complete attachment check
- traceable canonical evidence package
- zero-tolerance reconciliation and exception package
- monthly Ingresos workbook update
- monthly Forecast workbook update with formula-range verification
- Banorte and AMEX matching plus pending-collection calculations
- REVISION document generation and Drive storage
- morning validation/review notification
- Supabase workflow records, documents, tasks, exceptions, reviews, events and
  watchdog entries

Any missing attachment, unconfirmed layout, low-confidence extraction,
unclassified bank movement or mismatch must stop the workflow at
`requires_review`.
