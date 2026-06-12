# ADR-0009: Corte Santo Payment-Form Reconciliation and REVISION Document

Date: 2026-06-11

## Status

Accepted. Supersedes the reconciliation model introduced after ADR-0007.

## Context

The first Corte Santo reconciliation implementation modeled the day as a single
identity, `sales_total ≈ bank_deposit + cash_count`, with `cash_tolerance` and
`deposit_tolerance` thresholds. The dashboard also emitted a placeholder
"Reporte de Cierre Diario" PDF (which additionally shipped a broken
`{currentOffset}` `startxref`).

The client provided two source documents:

- A `REVISION` report (the actual document stored in Drive) structured per unit
  (SANTO, SOOP, TIGRE, Do Central, FIAMMA PEDREGAL/REFORMA, REKO, SANTO LA,
  SECO, ...).
- A full walkthrough of the Corte Santo workflow.

The real process is a multi-form reconciliation, not a single sales-vs-deposit
check: each payment form (Amex, Banorte debit/credit, efectivo, transferencia,
Uber Eats, Rappi, PayPal) is compared between "Cierre Ter/Pla" (what terminals
and platforms reported) and "Cierre Sistema" (what Wansoft recorded), and
`Total Real` must equal `Total Sistema`. The output report has VTA POR DIA,
VTA AL DIA, VTA META DEL MES, SALDOS, INGRESOS/GASTOS ADICIONALES, FALTA POR
ENTRAR EN LA CUENTA and AJUSTES DEL DIA sections.

## Decision

1. Replace the `reconcile(sales_total, bank_deposit, cash_count, ...)` model
   with `reconcile(cierre_terminal, cierre_sistema, config)` that compares
   confirmed `payment_forms` by `consumo`/`propina`/`global`, rolls them up into
   report groups (Amex / Bancos / Efectivo / Transferencia / Plataformas) and
   flags any group or Total Real vs Total Sistema difference above
   `thresholds.reconciliation_tolerance` as a `reconciliation_discrepancy`.
2. Add `build_revision_document(...)` to produce the structured REVISION report
   matching the client format per unit. The observed `TOTAL = saldo_banorte -
   prov_utilidades` rule is applied only as a default and can be overridden by
   payload.
3. Drive `payment_forms` and `reconciliation_tolerance` from confirmed config.
   No unit code, account, payment form, threshold or reviewer is hardcoded; the
   form→group rollup is treated as document structure, not a business rule.
4. Rewrite the dashboard Corte Santo PDF generator to render the REVISION format
   from `workflow_run.revision_document`, and fix the `startxref`/`{streamContent}`
   PDF assembly bugs via a shared `assembleSimplePdf` helper.

## Consequences

- The primary workflow now reflects the real Santo reconciliation and output
  format instead of a placeholder.
- Config requirements changed: `payment_forms` is now required, and
  `thresholds` uses `reconciliation_tolerance` instead of cash/deposit
  tolerances. Registry fixtures and `config.example.json` were updated.
- Reconciliation still returns `requires_review` whenever config or inputs are
  missing/unconfirmed; uncertainty never becomes `completed`.
- AI continues to classify, validate, reconcile, summarize and draft only; it
  performs no bank/SAT/payroll/portal actions.
- Exact thresholds, severities, the full per-unit roster and reviewer routing
  still require Santo confirmation in the Operational Addendum.
