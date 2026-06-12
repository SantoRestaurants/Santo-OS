# Requirements Document

## Introduction

This feature redesigns the **Corte Santo - Daily Sales Reconciliation** workflow so it reflects the real process the client follows and produces the real output document the client expects.

The current implementation models reconciliation as a single comparison `sales_total ≈ bank_deposit + cash_count` with two tolerances, and the only PDF fixture in the repo is a synthetic placeholder that does not match the real client format. Both are incorrect.

The real process is a **multi-form-of-payment reconciliation**. For each business unit and business date, a reviewer validates that the terminal/platform close (`Cierre Ter/Pla`) agrees with the POS system close (`Cierre Sistema`) for every form of payment (American Express, debit card, credit card, real cash, bank transfer, Uber Eats, Rappi), confirms that `Total Real == Total Sistema`, integrates courtesies (`cortesías`) as unregistered cash that is part of gross sales, computes per-channel pending collections (`Falta por entrar en la cuenta`) using deposit-timing rules, updates sales projections, and produces a multi-unit daily review document (`REVISION`) that is saved to the configured Drive location.

This document captures the requirements for that redesigned workflow. It treats all operational inputs that are not yet confirmed by the client (thresholds, severities, mandatory attachments, reviewer map, restaurant/entity/RFC map, definitive Drive routes, Agent Mail subject convention) as configurable inputs. When any required configuration is missing, the workflow degrades to `requires_review` and never silently completes. The workflow may classify, validate, summarize and recommend, but must never autonomously execute bank, SAT, payroll, IDSE, IMSS, legal, fiscal or government-portal actions.

This redesign supersedes the PR 6 intake-only scope described in ADR-0007 by adding the PR 7 reconciliation model, while preserving the same registry-spine integration and safety posture.

## Glossary

- **Corte_Santo_Workflow**: The system component that ingests daily cortes, performs multi-form-of-payment reconciliation, integrates courtesies, computes pending collections, generates the REVISION document, and connects to the registry spine. Referred to as "THE Corte_Santo_Workflow".
- **Business_Unit**: A single restaurant/brand whose corte is reviewed (for example SANTO, SOOP, TIGRE, Do Central, FIAMMA PEDREGAL, FIAMMA REFORMA, REKO, SANTO LA, SECO). Each Business_Unit is defined in the `restaurant_entity_rfc_map` configuration.
- **Business_Date**: The single calendar date whose corte is being reviewed.
- **Corte**: The daily cash/sales close submitted by a cashier, including system reports, terminal batch-close images, cash detail, delivery-app reports, the Corte Excel workbook and the discounts Excel workbook.
- **Cierre_Ter_Pla**: The terminal/platform close block. Columns: Amex, Bancos, Efectivo Real, Transferencia, Uber Eats, Rappi. Rows: Consumo, Propina, Global.
- **Cierre_Sistema**: The POS system (Wansoft) close block. Columns: Amex, T Debito, T Credito, Total Bancos, Efectivo Sistema. Rows: Consumo, Propina, Global.
- **Form_Of_Payment**: A single payment channel reconciled across the two close blocks (Amex, T Debito, T Credito, Efectivo, Transferencia, Uber Eats, Rappi).
- **Total_Real**: The total of the terminal/platform close (real-world side).
- **Total_Sistema**: The total of the POS system close (system side).
- **Cortesia**: A courtesy item (for example a comped dish) that is cash not registered in the POS system but that is part of total/gross sales (`Venta Bruta`).
- **Venta_Bruta**: Gross sales for the Business_Date, equal to system sales plus integrated courtesies.
- **Pending_Collection**: An amount earned on the Business_Date but not yet deposited into the bank account, tracked under "Falta por entrar en la cuenta" per channel (COBROS DE AMEX, COBROS UBER, COBROS RAPPI, COBROS PAYPAL, COBROS BANORTE/TRANSFERENCIA, CXC).
- **Deposit_Timing_Rule**: The configured schedule that determines when a channel's earnings are expected to deposit (Banorte next-day, Amex 3–5 days, Uber weekly on Mondays for the Monday–Sunday period, Rappi on Fridays for the Friday–Thursday period).
- **CXC**: Accounts receivable (cuentas por cobrar), increased only when a CXC is identified in the Wansoft close.
- **Revision_Document**: The multi-unit daily review report saved to Drive, containing per-unit sections (VTA POR DIA, VTA AL DÍA, VTA META DEL MES, SALDOS, INGRESOS ADICIONALES, GASTOS ADICIONALES, FALTA POR ENTRAR EN LA CUENTA, AJUSTES DEL DÍA).
- **Unit_Locale**: The language/format variant of a Business_Unit. Mexican units use Spanish with "Cifras con IVA"; SANTO LA and SECO use English without taxes ("amounts without taxes").
- **Reviewer_Map**: Configuration mapping each exception type to the human reviewer responsible.
- **Registry_Spine**: The Supabase/Postgres records every workflow connects to: workflows, workflow_runs, documents, tasks, exceptions, approvals/reviews, watchdog_log and events.
- **Required_Configuration**: The set of configured inputs the workflow needs: `restaurant_entity_rfc_map`, `drive_folder_map`, `mandatory_attachments`, `reviewer_map`, `corte_thresholds`, `deposit_timing_rules`, and `agent_mail_routing_rules`.
- **Requires_Review_State**: The terminal status `requires_review` produced when configuration, inputs or reconciliation results are uncertain.

## Requirements

### Requirement 1: Workflow intake and run registration

**User Story:** As an operations reviewer, I want each submitted corte to create a tracked workflow run scoped to one Business_Unit and Business_Date, so that every reconciliation is auditable in the registry spine.

#### Acceptance Criteria

1. WHEN a corte intake payload is received, THE Corte_Santo_Workflow SHALL create a workflow_run record scoped to one Business_Unit and one Business_Date.
2. THE Corte_Santo_Workflow SHALL compute a deterministic idempotency key from the workflow key, Business_Date, Business_Unit and submitted document identifiers.
3. WHEN a corte intake payload with an idempotency key matching an existing workflow_run is received, THE Corte_Santo_Workflow SHALL reuse the existing workflow_run rather than creating a duplicate run.
4. IF the intake payload omits Business_Date or Business_Unit, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-input exception.
5. WHEN a workflow_run is created, THE Corte_Santo_Workflow SHALL emit a `workflow_run.proposed` event to the Registry_Spine.
6. THE Corte_Santo_Workflow SHALL support a dry_run input that prepares all records without committing external side effects.

### Requirement 2: Configuration gating and safe degradation

**User Story:** As a compliance owner, I want the workflow to refuse to complete when required configuration is missing, so that unconfirmed business rules are never guessed.

#### Acceptance Criteria

1. WHEN a workflow_run begins, THE Corte_Santo_Workflow SHALL validate that each item of Required_Configuration is present and contains no `[CONFIRM]` placeholder value.
2. IF any item of Required_Configuration is missing or contains a `[CONFIRM]` placeholder, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception listing each missing configuration key.
3. IF the resolved Business_Unit is absent from the `restaurant_entity_rfc_map` configuration, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception identifying the unmapped Business_Unit.
4. THE Corte_Santo_Workflow SHALL read every threshold, severity, reviewer, restaurant code, RFC, Drive path, mandatory-attachment rule and deposit-timing rule from configuration rather than from hardcoded values.
5. WHILE Required_Configuration is incomplete, THE Corte_Santo_Workflow SHALL NOT assign the workflow_run a `completed` status.

### Requirement 3: Evidence intake and document registration

**User Story:** As a reviewer, I want each corte's attachments validated and registered, so that reconciliation runs against complete and verified evidence.

#### Acceptance Criteria

1. WHEN a corte intake payload includes documents, THE Corte_Santo_Workflow SHALL create a document record for each submitted document with its document type, source system and source URI.
2. IF a submitted document is missing its source_hash, THEN THE Corte_Santo_Workflow SHALL set that document record status to requires_review and record a document-review exception.
3. WHEN the configured `mandatory_attachments` set is evaluated against the submitted document types, THE Corte_Santo_Workflow SHALL record a missing-documents exception for each mandatory attachment type that is absent.
4. IF one or more mandatory attachments are missing, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review.
5. WHEN documents are registered, THE Corte_Santo_Workflow SHALL record the configured Drive destination path for the Business_Unit, Business_Date, year and month from the `drive_folder_map` configuration.

### Requirement 4: Multi-form-of-payment reconciliation (Cierre Ter/Pla vs Cierre Sistema)

**User Story:** As a reviewer, I want the terminal/platform close compared against the system close for every form of payment, so that POS sales correspond to actual bank income.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL reconcile the Cierre_Ter_Pla block against the Cierre_Sistema block for each configured Form_Of_Payment.
2. WHEN a Form_Of_Payment is reconciled, THE Corte_Santo_Workflow SHALL compare the Consumo, Propina and Global rows between the Cierre_Ter_Pla block and the Cierre_Sistema block.
3. IF the absolute difference for a Form_Of_Payment exceeds the configured tolerance for that Form_Of_Payment, THEN THE Corte_Santo_Workflow SHALL record a reconciliation-discrepancy exception identifying the Form_Of_Payment, the expected amount, the actual amount and the difference.
4. WHERE the `corte_thresholds` configuration defines a high-severity multiplier, THE Corte_Santo_Workflow SHALL assign a reconciliation-discrepancy exception high severity when the difference exceeds the tolerance multiplied by the high-severity multiplier, and medium severity otherwise.
5. IF the `corte_thresholds` configuration does not define a tolerance for a reconciled Form_Of_Payment, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.
6. WHEN reconciliation completes with no discrepancy exceptions and no other requires_review condition, THE Corte_Santo_Workflow SHALL set the workflow_run status to ready_for_approval.

### Requirement 5: Total Real equals Total Sistema check

**User Story:** As a reviewer, I want the total real-world figures to match the total system figures, so that registration errors are caught before approval.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL compute Total_Real from the Cierre_Ter_Pla block and Total_Sistema from the Cierre_Sistema block.
2. IF the absolute difference between Total_Real and Total_Sistema exceeds the configured total-reconciliation tolerance, THEN THE Corte_Santo_Workflow SHALL record a total-mismatch exception and set the workflow_run status to requires_review.
3. THE Corte_Santo_Workflow SHALL include Total_Real, Total_Sistema and the difference in the reconciliation summary.
4. WHEN Total_Real equals Total_Sistema within the configured tolerance, THE Corte_Santo_Workflow SHALL record the total-reconciliation check as passed.

### Requirement 6: Cash control validation

**User Story:** As a reviewer, I want real cash validated against the cash control breakdown and tips, so that cash income and tip distribution are correct.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL compute real cash from the configured cash control components: Fondo de Caja, (+) Por Ventas, (+) Por Propina, (+) Depósitos, and (-) Vales.
2. IF the computed real cash differs from the reported Efectivo Real by more than the configured cash tolerance, THEN THE Corte_Santo_Workflow SHALL record a cash-discrepancy exception and set the workflow_run status to requires_review.
3. THE Corte_Santo_Workflow SHALL validate reported tip balances against the cash detail components: Propinas Efectivo, Transferencia/Anticipos, CXC, Cortesia Direccion and Efectivo Venta.
4. IF a reported tip balance differs from its corresponding cash detail component by more than the configured tip tolerance, THEN THE Corte_Santo_Workflow SHALL record a tip-discrepancy exception and set the workflow_run status to requires_review.

### Requirement 7: Courtesy (cortesías) integration into gross sales

**User Story:** As a reviewer, I want courtesies added to total cash and gross sales, so that Venta_Bruta reflects all sales including unregistered cash.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL treat each Cortesia as cash that is not registered in the POS system but is part of total sales.
2. WHEN courtesies are provided for a Business_Date, THE Corte_Santo_Workflow SHALL add the courtesy total to system sales to compute Venta_Bruta.
3. THE Corte_Santo_Workflow SHALL include the courtesy total and the resulting Venta_Bruta in the reconciliation summary.
4. IF the courtesy total causes Venta_Bruta to differ from the global report Total de Ventas by more than the configured tolerance, THEN THE Corte_Santo_Workflow SHALL record a gross-sales-mismatch exception and set the workflow_run status to requires_review.

### Requirement 8: Per-channel pending collections with deposit-timing rules

**User Story:** As a reviewer, I want pending collections computed per channel using deposit-timing rules, so that "Falta por entrar en la cuenta" reflects money earned but not yet deposited.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL compute a Pending_Collection amount for each configured channel: COBROS DE AMEX, COBROS UBER, COBROS RAPPI, COBROS PAYPAL, COBROS BANORTE/TRANSFERENCIA and CXC.
2. WHERE the `deposit_timing_rules` configuration defines a settlement window for a channel, THE Corte_Santo_Workflow SHALL use that window to determine which earnings are expected to have deposited by the Business_Date.
3. WHEN computing COBROS DE AMEX, THE Corte_Santo_Workflow SHALL match American Express deposits in the bank statement using the configured deposit-description pattern and sum the amounts that have not yet settled.
4. WHEN computing COBROS BANORTE/TRANSFERENCIA, THE Corte_Santo_Workflow SHALL match Banorte deposits using the configured deposit-description pattern and subtract deposited amounts from earned amounts to derive the pending balance.
5. WHEN computing COBROS UBER, THE Corte_Santo_Workflow SHALL sum the amount generated over the configured Uber settlement period.
6. WHEN computing COBROS RAPPI, THE Corte_Santo_Workflow SHALL sum the amount generated over the configured Rappi settlement period.
7. THE Corte_Santo_Workflow SHALL increase CXC only when a CXC entry is identified in the Wansoft close.
8. IF the `deposit_timing_rules` configuration is missing a settlement window for a channel being computed, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.

### Requirement 9: Additional income and additional expenses

**User Story:** As a reviewer, I want additional income and additional expenses captured, so that non-recurring client transfers and domiciled charges are reflected in the review.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL record each additional-income item (for example client transfers for reservations, deposits and events) with its amount and description.
2. THE Corte_Santo_Workflow SHALL record each additional-expense item with its amount and description.
3. WHERE a Business_Unit has Unit_Locale English (SANTO LA, SECO), THE Corte_Santo_Workflow SHALL represent additional expenses split into a debit-account list and a credit-account list, each item carrying date, description and amount.
4. THE Corte_Santo_Workflow SHALL include additional income and additional expenses in the Revision_Document section for the Business_Unit.

### Requirement 10: Daily adjustments capture

**User Story:** As a reviewer, I want daily adjustments recorded with observations, so that discounts, voids and cancellations are documented.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL record daily adjustments with concept, amount and observations for the categories Descuentos, Anulaciones and Cancelaciones.
2. THE Corte_Santo_Workflow SHALL preserve free-text observation values associated with each adjustment.
3. THE Corte_Santo_Workflow SHALL include the daily adjustments table in the Revision_Document section for the Business_Unit.

### Requirement 11: REVISION output document generation

**User Story:** As an operations owner, I want a multi-unit REVISION document generated and saved to Drive, so that the daily review matches the real client output format.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL generate a Revision_Document containing one section per Business_Unit included in the run.
2. THE Corte_Santo_Workflow SHALL include, for each Business_Unit section, a VTA POR DIA block with columns DIA, FECHA, META DE VTA, VENTA REAL and DIFERENCIA covering the Business_Date and the following day.
3. THE Corte_Santo_Workflow SHALL include, for each Business_Unit section, a VTA AL DÍA block with META DE VTA, VENTA REAL, DIFERENCIA and %DIFERENCIA, and a VTA META DEL MES block with META DE VTA, VENTA REAL and DIFERENCIA.
4. THE Corte_Santo_Workflow SHALL include, for each Business_Unit section, a SALDOS block, a FALTA POR ENTRAR EN LA CUENTA block, an AJUSTES DEL DÍA block, and additional income and additional expenses blocks.
5. WHERE a Business_Unit is configured with monthly events tracking, THE Corte_Santo_Workflow SHALL include a VTA EVENTOS MENSUAL block and an ACUMULADO CORTESÍAS % block in that Business_Unit section.
6. THE Corte_Santo_Workflow SHALL include a corte-format status note for each Business_Unit section ("*FORMATO DE CORTE, BIEN / OK" for Spanish units and "*DAILY SALES REPORT, OK" for English units).
7. WHEN the Revision_Document is generated, THE Corte_Santo_Workflow SHALL create a document record referencing the configured Drive destination path for the Business_Date.
8. IF the `drive_folder_map` configuration does not resolve a destination path for the Business_Unit and Business_Date, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.

### Requirement 12: Bilingual unit variation (ES/EN)

**User Story:** As a reviewer of international units, I want each unit rendered in its configured locale, so that SANTO LA and SECO use English without taxes while Mexican units use Spanish with IVA.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL determine the Unit_Locale for each Business_Unit from configuration.
2. WHERE a Business_Unit has Unit_Locale Spanish, THE Corte_Santo_Workflow SHALL render its section in Spanish and label amounts as "Cifras con IVA".
3. WHERE a Business_Unit has Unit_Locale English, THE Corte_Santo_Workflow SHALL render its section in English using the labels REVIEW, SALE OF THE DAY, DAILY SALES REPORT, FORECAST and REAL SALE, and represent amounts without taxes.
4. WHERE a Business_Unit has Unit_Locale English, THE Corte_Santo_Workflow SHALL render the balances block as BALANCE with BANK ACCOUNT and TOTAL rows.

### Requirement 13: Registry spine and event integration

**User Story:** As a system operator, I want every reconciliation to write to the registry spine, so that runs, tasks, documents, exceptions, events and watchdog state are auditable.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL create task records for evidence registration, configuration review, reconciliation and Revision_Document generation, each carrying a status.
2. WHEN an exception is recorded, THE Corte_Santo_Workflow SHALL assign the reviewer for that exception type from the `reviewer_map` configuration.
3. IF the `reviewer_map` configuration does not define a reviewer for a recorded exception type, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.
4. WHEN the workflow_run reaches a terminal status, THE Corte_Santo_Workflow SHALL emit a corresponding event (`workflow_run.requires_review` or `workflow_run.ready_for_approval`) to the Registry_Spine.
5. THE Corte_Santo_Workflow SHALL write a watchdog_log entry recording the final reconciliation status and severity for the workflow_run.
6. WHEN the workflow_run is triggered, THE Corte_Santo_Workflow SHALL accept the trigger only through the shared command handler channels declared in the `agent_mail_routing_rules` configuration.

### Requirement 14: AI safety boundary

**User Story:** As a compliance owner, I want the AI restricted to classification and review-package preparation, so that no high-risk external action is taken autonomously.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL limit AI actions to classifying, validating, summarizing and recommending.
2. THE Corte_Santo_Workflow SHALL produce review packages and logs rather than final external actions for any bank, SAT, payroll, IDSE, IMSS, legal, fiscal or government-portal step.
3. IF a step would require a bank, SAT, payroll, IDSE, IMSS, legal, fiscal or government-portal action, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and route the step to a human reviewer.
4. WHILE the reconciliation outcome is uncertain, THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review rather than completed.

### Requirement 15: Reconciliation summary and round-trip integrity of structured figures

**User Story:** As a reviewer, I want a complete, machine-readable reconciliation summary that round-trips with the source figures, so that the review package is accurate and auditable.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL produce a reconciliation summary containing, per Form_Of_Payment, the Cierre_Ter_Pla amounts, the Cierre_Sistema amounts and the computed difference.
2. THE Corte_Santo_Workflow SHALL include Total_Real, Total_Sistema, courtesy total, Venta_Bruta and each Pending_Collection amount in the reconciliation summary.
3. WHEN structured corte figures are serialized into the reconciliation summary and then parsed back, THE Corte_Santo_Workflow SHALL produce figures equivalent to the original input (round-trip property).
4. THE Corte_Santo_Workflow SHALL include the reconciliation summary in the workflow_run output regardless of terminal status.
