# Corte Santo Stabilization Plan

Status: proposal for review, not yet an accepted architecture decision.

## Why This Exists

The current implementation can calculate the right number in one run and still
show the wrong number later. Business facts are distributed across duplicate
`workflow_runs`, nested `output_payload` objects, revision snapshots, forecast
documents and Excel workbooks. Dashboard code then selects and combines those
copies with fallback rules.

The immediate goal is to correct the reported June issues. The larger goal is
to make one business fact have one definition, one canonical storage location
and a visible source trail.

## Confirmed Product Requirements

### Outstanding collections

- Show one card named `Falta por entrar hasta hoy`.
- It is independent of the selected dashboard day.
- It includes every collection expected on or before today that has not been
  matched to bank evidence.
- It can be grouped by source business date and payment channel.
- A day is not all-or-nothing. Matching one collection must not hide other
  unmatched collections from the same day.
- For the current example, the balance should be derived from the open items for
  June 29, June 30 and July 1, excluding any item already found in the bank file.

### Sales reporting

- `Venta Real` means the value under the `Venta Bruta` header in the Corte Excel.
- It must not use `Total Bruto` or the reconciliation block's `total_real` as a
  substitute.
- The same definition must drive the daily detail, weekly totals, monthly total,
  charts, variance against forecast and AI context.
- The Socios view must show each calendar date with its weekday, daily actual and
  daily target, plus a week-by-week breakdown.
- A month with imported historical facts must work even when there is no current
  workflow run for every date.

### CxC and PayPal

Example: a MXN 2,000 receivable is created on June 7 and paid on June 17.

- Creation is identified from the email body.
- On June 7, add MXN 2,000 to the PayPal cell and write the receivable details in
  the PayPal note.
- Settlement is identified from the later email body and supported by the CxC
  image showing the amount received.
- On June 17, write settlement details in that day's PayPal note.
- Do not add the MXN 2,000 principal again on June 17.
- If settlement reveals a tip that was not known at creation, add only that tip
  to PayPal on June 17 and include it in that day's note.
- The receivable needs a stable identity so creation and settlement cannot be
  counted twice when emails are reprocessed.

## Current Failure Modes Found

1. `dailySales()` prefers `revision.reconciliation_totals.total_real`. This is a
   reconciliation total, not the confirmed `Venta Bruta` business metric.
2. Socios recalculates the monthly total only from workflow runs, overriding a
   broader forecast/history calculation. Months without complete runs can show
   zero or partial totals even when daily forecast metadata exists.
3. Socios reads `falta_por_entrar` from the selected run's revision snapshot, so
   changing the selected date changes what appears to be a global outstanding
   balance.
4. The bank watcher skips whole runs already marked `bank_validated` and dedupes
   by date before constructing expected collections. This cannot represent
   partially settled days reliably.
5. Duplicate runs are resolved by a UI quality score. A dashboard heuristic is
   currently deciding which copy of a financial fact is canonical.
6. Important facts such as sales, income channels and expected collections are
   nested in mutable JSON payloads. Historical imports and later stages must
   merge payloads carefully to avoid erasing prior facts.

## Proposed Simpler Data Contract

Keep `workflow_runs` as execution and audit history. Stop using it as the primary
read model for financial facts.

### `corte_daily_records`

One readable row per `(restaurant_id, business_date)`, enforced by a unique
constraint. It stores explicit columns for AMEX, debit, credit, cash, transfer,
total, PayPal, Uber Eats, Rappi, tips, Venta Bruta, Total Bruto and forecast.
It also stores source workbook, sheet, row, hash and parser version.

This is the stable daily identity regardless of how many emails, retries or
workflow runs touch it. `venta_bruta` is the only value exposed as Venta Real.
Historical imports and automatic Cortes upsert the same row; they do not create
synthetic workflow runs. Unknown spreadsheet columns are retained in
`extra_values` until promoted to explicit confirmed fields.

### `receivables`

One row per CxC with `receivable_key`, creation day, principal, settlement day,
settled principal, settlement tip, status and evidence references. Creation and
settlement are separate events attached to the same receivable.

### `expected_collections`

One row per expected bank movement, not one snapshot per run.

Core fields: `operational_day_id`, `channel`, `amount`, `expected_on`, `status`,
`matched_bank_transaction_id`, `source_type`, `source_id`.

Allowed lifecycle: `expected`, `partially_matched`, `matched`, `cancelled`,
`requires_review`. `Falta por entrar hasta hoy` is a database query over open
rows with `expected_on <= today`.

### `bank_transactions` and `collection_matches`

Store normalized statement movements once. Matching records connect one or more
expected collections to bank transactions and preserve the matching evidence.
No run or day needs to be marked wholly settled to hide an individual item.

## Source Mapping

| Business fact | Authoritative input | Canonical field | Used by |
| --- | --- | --- | --- |
| Venta Real | Ingresos `Venta Bruta` | `corte_daily_records.venta_bruta` | day, week, month, chart, AI |
| Forecast | Forecast workbook daily target | `corte_daily_records.forecast_target` | variance and chart |
| Income by channel | Corte Excel plus confirmed adjustments | explicit `corte_daily_records` columns | Ingresos and detail |
| CxC principal created | Email body | `receivables.principal` plus creation-day PayPal amount | Ingresos and audit |
| CxC settlement | Email body plus CxC image | settlement fields and evidence | note and status |
| CxC settlement tip | CxC image | settlement-day PayPal amount | Ingresos and audit |
| Outstanding collection | Expected collection minus matches | query result, not a snapshot | global outstanding card |

## Delivery Sequence

### Phase 0: prove the data

- Obtain the exact Corte Excel header/cell examples for `Venta Bruta` and
  `Total Bruto`.
- Audit June 1 through July 1 into a table: date, expected Venta Bruta, current
  displayed value, current run count and open collections.
- Add regression fixtures for June 29, June 30 and the CxC creation/settlement
  example before changing production behavior.

### Phase 1: correct definitions

- Extract and persist `gross_sales` explicitly from `Venta Bruta`.
- Make all dashboard calculations use one selector for canonical gross sales.
- Make monthly and weekly views date-complete and show weekday labels.
- Compute the global outstanding card from item-level expected collections.

### Phase 2: introduce canonical tables

- Add the proposed tables with constraints, RLS and source references.
- Dual-write from the existing workflow while keeping JSON output for rollback.
- Backfill historical days idempotently, producing an exception report for
  conflicting values instead of choosing silently.
- Switch dashboard reads to database views over canonical tables.

### Phase 3: remove accidental complexity

- Stop UI deduplication from determining financial truth.
- Reduce `output_payload` to execution details and summaries that can be rebuilt.
- Centralize Excel adapters by normalized header and versioned mapping.
- Document every input-to-field transformation and its tests beside the adapter.

## Acceptance Checks

- Selecting June 29, June 30 or July 1 shows the same global outstanding total.
- Matching one bank item changes only that item and immediately updates the
  global total.
- June Venta Real equals the sum of June `Venta Bruta` source cells.
- Daily, weekly, monthly, chart and AI totals reconcile to the same rows.
- Reprocessing the same CxC emails produces no duplicate principal or tip.
- Loading historical data does not create a second operational day or overwrite
  newer reviewed facts.
- Every displayed financial value can show its source document, header/cell and
  last update.
