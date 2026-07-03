# ADR-0015: Corte observed sales and month boundaries

## Decision

- `corte_daily_records.venta_bruta` is the canonical observed daily sale.
- Forecast workbooks provide targets only; their `venta_real` cells are never a
  dashboard fallback when no Corte/daily record exists.
- Reusing a projection template for a new month clears prior observed sales.
- Drive workbook writes require an exact month/year match. Missing monthly files
  produce `requires_review` until a controlled month-creation workflow creates
  and registers the new workbook.
- Supervisor corrections update both the canonical daily row and workflow audit
  payload; approval does not hide or silently reinterpret a discrepancy.

## Reason

June actuals were being rebased into future July dates, while stale forecast
documents caused the chart and KPI to use different monthly targets. Explicit
source roles and month boundaries prevent both classes of corruption.
