# Requirements Document

## Introduction

This feature redesigns the **Corte Santo - Daily Sales Reconciliation** workflow, the SantoOS P0 primary workflow, so it matches the real end-to-end process the client performs and produces the real output document the client expects.

The current implementation in `workflows/corte_santo/` is wrong in two ways. First, it models reconciliation as a single simplistic comparison `sales_total ≈ bank_deposit + cash_count` governed by two tolerances. Second, the only output fixture in the repository (`apps/dashboard/public/fixtures/corte-santo-2026-06-08.pdf`) is a hand-made placeholder that does not match the client's real format. The client has now provided the real output document format (the per-unit **REVISION** report) and a full walkthrough of the real daily process.

The real process is a **multi-form-of-payment reconciliation performed per business unit and business date**. A cashier sends the previous day's corte by email; an administrator intakes the attachments, files them, validates the card-terminal closes (AMEX and Banorte) against vouchers and batch-close images, validates real cash against the cash detail, validates delivery-app totals (Uber Eats, Rappi) against their apps, cross-checks the corte against the Wansoft system close form-by-form, and confirms the core invariant that **Total Real equals Total Sistema**. The administrator then registers the day's sales in the cloud income report, integrates courtesies (`cortesías`) as unregistered cash that is part of gross sales, updates the sales projection file, builds the **REVISION** document, imports bank statements (Banorte and AMEX), computes per-channel pending collections (`Falta por entrar en la cuenta`) using channel-specific deposit-timing windows and statement-matching legends, and finalizes balances. The final artifact is the multi-unit REVISION document saved to the configured Drive location.

This document captures the requirements for that redesigned workflow. It treats all operational inputs that the client has not yet confirmed as configuration: thresholds, severities, mandatory-attachment sets, reviewer map, restaurant/entity/RFC map, Drive folder routes, Agent Mail routing convention, statement-matching legends, deposit-timing windows, per-unit channel sets, per-unit section sets, per-unit TOTAL formulas and locale. When any required configuration is missing, the workflow degrades to `requires_review` and never silently completes. The workflow may classify, validate, summarize and recommend, but must never autonomously execute bank, SAT, payroll, IDSE, IMSS, legal, fiscal or government-portal actions.

This redesign supersedes the PR 6 intake-only scope described in ADR-0007 by adding the full reconciliation and document-generation behavior, while preserving the registry-spine integration and safety posture defined in `ai_brain/build_rules.md` and `AGENTS.md`. The repo currently scopes Corte Santo as "PR6 intake only / PR7 reconciliation pending"; this redesign defines the target behavior while keeping unconfirmed operational inputs as `requires_review`.

## Glossary

- **Corte_Santo_Workflow**: The system component that intakes daily cortes, files evidence, performs multi-form-of-payment reconciliation, integrates courtesies, computes pending collections, generates the REVISION document, and connects to the Registry_Spine. Referred to as "THE Corte_Santo_Workflow".
- **Business_Unit**: A single restaurant/brand whose corte is reviewed (for example SANTO, SOOP, TIGRE, Do Central, FIAMMA PEDREGAL, FIAMMA REFORMA, REKO, SANTO LA, SECO). Each Business_Unit is defined in the `restaurant_entity_rfc_map` configuration.
- **Business_Date**: The single calendar date (the corte day) whose corte is being reviewed.
- **Corte**: The daily cash/sales close submitted by a cashier for one Business_Unit and Business_Date.
- **Mandatory_Attachment_Set**: The configured set of documents that must be present in a corte email for intake to proceed (for example: Reporte global de sistema, Cierres de Lote de terminales, Detalle del efectivo, Aplicaciones de entrega, Documento de Corte en Excel, Documento de descuentos en Excel).
- **Cierre_Ter_Pla**: The terminal/platform close block. Columns include Amex, Bancos, Efectivo Real, Transferencia, Uber Eats and Rappi. Rows are Consumo, Propina and Global.
- **Cierre_Sistema**: The POS system (Wansoft) close block. Columns include Amex, T Debito, T Credito, Total Bancos and Efectivo Sistema. Rows are Consumo, Propina and Global.
- **Form_Of_Payment**: A single payment channel reconciled across the two close blocks (for example Amex, T Debito, T Credito, Efectivo, Transferencia, Uber Eats, Rappi, PayPal). The active set per Business_Unit is defined in configuration.
- **Total_Real**: The total of the terminal/platform close (real-world side).
- **Total_Sistema**: The total of the POS system (Wansoft) close (system side).
- **Terminal_Validation**: The check that the Excel corte amounts (Consumo, Propina, Global) for a card terminal match the batch-close (cierre de lote) images and vouchers for that terminal (AMEX and Banorte, with Banorte split into T Debito and T Credito).
- **Cash_Validation**: The check that "Efectivo Real" in the Detalle de Efectivo matches the amount recorded as "Depósito" in the report.
- **Delivery_Validation**: The check that a delivery channel's amount in the corte matches the channel app total (Uber Eats against the Uber "Historial de pedidos"; Rappi against the Rappi report).
- **Cortesia**: A courtesy item (for example a comped dish), registered in the reporte global, that is cash not registered in the POS system but is part of total/gross sales.
- **Venta_Bruta**: Gross sales for the Business_Date, equal to system sales plus integrated courtesies, verified against the reporte global "Total de Ventas".
- **Pending_Collection**: An amount earned on or before the Business_Date but not yet deposited into the bank account, tracked under "Falta por entrar en la cuenta" per channel.
- **Collection_Channel**: A pending-collection channel (for example COBROS DE AMEX, COBROS UBER, COBROS RAPPI, COBROS PAYPAL, COBROS DE BANORTE/TRANSFERENCIA, COBROS TOTAL PLAY, CXC). The active set per Business_Unit is defined in configuration.
- **Deposit_Timing_Rule**: The configured settlement schedule that determines when a Collection_Channel's earnings are expected to deposit (for example Banorte next-day, AMEX 3–5 days, Uber weekly on Mondays for the Monday–Sunday period, Rappi on Fridays for the Friday–Thursday period).
- **Statement_Legend**: The configured text pattern used to identify a channel's deposits in a bank statement column (for example the AMEX SPEI legend in the "DESCRIPCIÓN DETALLADA" column, or the Banorte "REST SANTO HAND ROLL" legend in the "DESCRIPCIÓN" column).
- **CXC**: Accounts receivable (cuentas por cobrar), increased only when a CXC entry is identified in the Wansoft close.
- **Income_Report**: The cloud income workbook (Google Sheet) where the day's sales are registered (REPORTE INGRESOS by unit and month), with columns including Amex, Debito, Credito, Efectivo, PayPal, Uber Eats, Rappi, Propinas and Venta Bruta.
- **Projection_File**: The sales projection workbook (PROYECCION DE VTAS by unit and month) where Venta_Bruta is recorded per date, producing DIA, FECHA, META DE VTA, VENTA REAL, DIFERENCIA and % ALCANZADO.
- **Revision_Document**: The multi-unit daily review report saved to Drive (the "REVISION" / "REVISION_CORTE_<date>" file), containing one configured section per Business_Unit.
- **Unit_Locale**: The language/format variant of a Business_Unit. Mexican units use Spanish with "Cifras con IVA"; SANTO LA and SECO use English without taxes ("amounts without taxes").
- **Unit_Profile**: The per-Business_Unit configuration that defines its locale, active Form_Of_Payment set, active Collection_Channel set, active Revision_Document section set, and TOTAL (SALDOS) formula.
- **Reviewer_Map**: Configuration mapping each exception type to the human reviewer responsible.
- **Drive_Folder_Map**: Configuration mapping each Business_Unit, year, month and Business_Date to its Drive destination folders (intake filing folder and Revision_Document output folder).
- **Registry_Spine**: The Supabase/Postgres records every workflow connects to: workflows, workflow_runs, documents, tasks, exceptions, approvals/reviews, watchdog_log, events and email_messages.
- **Required_Configuration**: The set of configured inputs the workflow needs: `restaurant_entity_rfc_map`, `unit_profiles`, `drive_folder_map`, `mandatory_attachments`, `reviewer_map`, `corte_thresholds`, `deposit_timing_rules`, `statement_legends` and `agent_mail_routing_rules`.
- **Requires_Review_State**: The terminal status `requires_review` produced when configuration, inputs or reconciliation results are uncertain.

## Requirements

### Requirement 1: Email intake of the daily corte

**User Story:** As an operations administrator, I want each corte email and its attachments intaken and validated for completeness, so that reconciliation starts from a complete evidence set.

#### Acceptance Criteria

1. WHEN a corte email intake payload is received, THE Corte_Santo_Workflow SHALL create an email_messages record linking the email to one Business_Unit and one Business_Date.
2. WHEN a corte email is intaken, THE Corte_Santo_Workflow SHALL extract the list of attachment document types present in the email.
3. WHEN the extracted attachment types are evaluated against the configured Mandatory_Attachment_Set, THE Corte_Santo_Workflow SHALL record a missing-attachment exception for each mandatory document type that is absent.
4. IF one or more mandatory attachments are absent, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review.
5. IF the `mandatory_attachments` configuration is absent or contains a `[CONFIRM]` placeholder, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.
6. THE Corte_Santo_Workflow SHALL accept the corte intake trigger only through the shared command handler channels declared in the `agent_mail_routing_rules` configuration.

### Requirement 2: Workflow run registration and idempotency

**User Story:** As a system operator, I want each corte to create a tracked workflow run scoped to one Business_Unit and Business_Date, so that every reconciliation is auditable and never duplicated.

#### Acceptance Criteria

1. WHEN a corte intake payload is accepted, THE Corte_Santo_Workflow SHALL create a workflow_run record scoped to one Business_Unit and one Business_Date.
2. THE Corte_Santo_Workflow SHALL compute a deterministic idempotency key from the workflow key, Business_Date, Business_Unit and submitted document identifiers.
3. WHEN a corte intake payload with an idempotency key matching an existing workflow_run is received, THE Corte_Santo_Workflow SHALL reuse the existing workflow_run instead of creating a duplicate run.
4. IF the intake payload omits Business_Date or Business_Unit, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-input exception.
5. WHEN a workflow_run is created, THE Corte_Santo_Workflow SHALL emit a `workflow_run.proposed` event to the Registry_Spine.
6. THE Corte_Santo_Workflow SHALL support a dry_run input that prepares all records without committing external side effects.

### Requirement 2A: Configuration gating and safe degradation

**User Story:** As a compliance owner, I want the workflow to refuse to complete when required configuration is missing, so that unconfirmed business rules are never guessed.

#### Acceptance Criteria

1. WHEN a workflow_run begins, THE Corte_Santo_Workflow SHALL validate that each item of Required_Configuration is present and contains no `[CONFIRM]` placeholder value.
2. IF any item of Required_Configuration is missing or contains a `[CONFIRM]` placeholder, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception listing each missing configuration key.
3. IF the resolved Business_Unit is absent from the `restaurant_entity_rfc_map` configuration, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception identifying the unmapped Business_Unit.
4. THE Corte_Santo_Workflow SHALL read every threshold, severity, reviewer, restaurant code, RFC, Drive path, mandatory-attachment rule, statement legend, deposit-timing rule, channel set, section set and TOTAL formula from configuration rather than from hardcoded values.
5. WHILE Required_Configuration is incomplete, THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review instead of completed.

### Requirement 3: Evidence filing and document registration

**User Story:** As a reviewer, I want each corte's documents registered and routed to the configured Drive filing location, so that reconciliation runs against complete, traceable evidence.

#### Acceptance Criteria

1. WHEN a corte intake payload includes documents, THE Corte_Santo_Workflow SHALL create a document record for each submitted document with its document type, source system and source URI.
2. IF a submitted document is missing its source_hash, THEN THE Corte_Santo_Workflow SHALL set that document record status to requires_review and record a document-review exception.
3. WHEN documents are registered, THE Corte_Santo_Workflow SHALL resolve the configured intake filing folder for the Business_Unit, year, month and Business_Date from the `drive_folder_map` configuration.
4. IF the `drive_folder_map` configuration does not resolve an intake filing folder for the Business_Unit and Business_Date, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.
5. THE Corte_Santo_Workflow SHALL produce a proposed Drive filing action rather than executing the Drive write when dry_run is requested or when Drive credentials are absent.

### Requirement 4: Terminal validation (AMEX and Banorte)

**User Story:** As a reviewer, I want each card terminal's corte amounts validated against its batch-close images and vouchers, so that terminal sales are recorded correctly before system cross-check.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL validate the AMEX terminal Consumo, Propina and Global amounts in the Corte Excel against the corresponding AMEX batch-close (cierre de lote) values.
2. THE Corte_Santo_Workflow SHALL validate the Banorte terminal Consumo and Propina amounts in the Corte Excel against the Banorte voucher values, with Banorte split into T Debito and T Credito.
3. IF a Terminal_Validation amount differs from its batch-close or voucher value by more than the configured terminal tolerance, THEN THE Corte_Santo_Workflow SHALL record a terminal-discrepancy exception identifying the terminal, the expected value, the actual value and the difference.
4. IF the `corte_thresholds` configuration does not define a terminal tolerance, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.
5. WHEN a Terminal_Validation passes within tolerance, THE Corte_Santo_Workflow SHALL record the Terminal_Validation result as passed in the reconciliation summary.

### Requirement 5: Cash validation

**User Story:** As a reviewer, I want real cash validated against the cash detail and the recorded deposit, so that cash income is correct.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL compare the "Efectivo Real" value in the Detalle de Efectivo against the amount recorded as "Depósito" in the report.
2. IF the Efectivo Real value differs from the recorded Depósito by more than the configured cash tolerance, THEN THE Corte_Santo_Workflow SHALL record a cash-discrepancy exception and set the workflow_run status to requires_review.
3. THE Corte_Santo_Workflow SHALL validate reported tip balances against the cash detail components defined in configuration (for example Propinas Efectivo, Transferencia/Anticipos, CXC, Cortesía Dirección and Efectivo Venta).
4. IF a reported tip balance differs from its corresponding cash detail component by more than the configured tip tolerance, THEN THE Corte_Santo_Workflow SHALL record a tip-discrepancy exception and set the workflow_run status to requires_review.

### Requirement 6: Delivery-app validation (Uber Eats and Rappi)

**User Story:** As a reviewer, I want delivery-app amounts validated against the delivery apps, so that Uber Eats and Rappi sales in the corte match the platform records.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL validate the Uber Eats amount in the Cierre Sistema against the Uber "Historial de pedidos" total for the Business_Date.
2. THE Corte_Santo_Workflow SHALL validate the Rappi amount in the corte against the Rappi report total for the Business_Date.
3. IF a Delivery_Validation amount differs from the corresponding app total by more than the configured delivery tolerance, THEN THE Corte_Santo_Workflow SHALL record a delivery-discrepancy exception identifying the channel, the expected value, the actual value and the difference.
4. IF the `corte_thresholds` configuration does not define a delivery tolerance for a delivery channel being validated, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.

### Requirement 7: Multi-form-of-payment system cross-check (Cierre Ter/Pla vs Cierre Sistema)

**User Story:** As a reviewer, I want the terminal/platform close compared against the Wansoft system close for every form of payment, so that each rubro by payment form agrees between the two blocks.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL reconcile the Cierre_Ter_Pla block against the Cierre_Sistema block for each Form_Of_Payment in the Business_Unit's configured Form_Of_Payment set.
2. WHEN a Form_Of_Payment is reconciled, THE Corte_Santo_Workflow SHALL compare the Consumo, Propina and Global rows between the Cierre_Ter_Pla block and the Cierre_Sistema block.
3. IF the absolute difference for a Form_Of_Payment exceeds the configured tolerance for that Form_Of_Payment, THEN THE Corte_Santo_Workflow SHALL record a reconciliation-discrepancy exception identifying the Form_Of_Payment, the expected amount, the actual amount and the difference.
4. WHERE the `corte_thresholds` configuration defines a high-severity multiplier, THE Corte_Santo_Workflow SHALL assign a reconciliation-discrepancy exception high severity when the difference exceeds the tolerance multiplied by the high-severity multiplier, and medium severity otherwise.
5. IF the `corte_thresholds` configuration does not define a tolerance for a reconciled Form_Of_Payment, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.

### Requirement 8: Total Real equals Total Sistema invariant

**User Story:** As a reviewer, I want the total real-world figures to match the total system figures, so that registration errors are caught before approval.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL compute Total_Real from the Cierre_Ter_Pla block and Total_Sistema from the Cierre_Sistema block.
2. IF the absolute difference between Total_Real and Total_Sistema exceeds the configured total-reconciliation tolerance, THEN THE Corte_Santo_Workflow SHALL record a total-mismatch exception, record that the registration-error origin requires investigation, and set the workflow_run status to requires_review.
3. WHEN Total_Real equals Total_Sistema within the configured total-reconciliation tolerance, THE Corte_Santo_Workflow SHALL record the total-reconciliation check as passed.
4. THE Corte_Santo_Workflow SHALL include Total_Real, Total_Sistema and the difference in the reconciliation summary.
5. IF the `corte_thresholds` configuration does not define a total-reconciliation tolerance, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.

### Requirement 9: Courtesy (cortesías) integration into gross sales

**User Story:** As a reviewer, I want courtesies added to total cash and gross sales, so that Venta_Bruta reflects all sales including cash not registered in the system.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL treat each Cortesia as cash that is not registered in the POS system but is part of total sales.
2. WHEN courtesies are provided for a Business_Date, THE Corte_Santo_Workflow SHALL add the courtesy total to system sales to compute Venta_Bruta.
3. THE Corte_Santo_Workflow SHALL include the courtesy total and the resulting Venta_Bruta in the reconciliation summary.
4. IF the computed Venta_Bruta differs from the reporte global "Total de Ventas" by more than the configured gross-sales tolerance, THEN THE Corte_Santo_Workflow SHALL record a gross-sales-mismatch exception and set the workflow_run status to requires_review.

### Requirement 10: Income report registration

**User Story:** As a reviewer, I want the day's sales prepared for the cloud income report, so that registered amounts and tips reconcile with the reporte global totals.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL prepare the Income_Report column values for the Business_Date from the configured Form_Of_Payment set, including Amex, Debito, Credito, Efectivo and the delivery channels (PayPal, Uber Eats, Rappi).
2. THE Corte_Santo_Workflow SHALL compute the Propinas value as the sum of the propinas from Amex, T Debito and T Credito only.
3. THE Corte_Santo_Workflow SHALL compute the Venta_Bruta column value and verify it against the reporte global "Total de Ventas".
4. WHERE the `utility_receipt_config` or income-report Sheets scope is not confirmed for write access, THE Corte_Santo_Workflow SHALL record proposed Income_Report values without executing a Sheets write.
5. IF an Income_Report column required by the Business_Unit's configured Form_Of_Payment set has no source value, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-input exception.

### Requirement 11: Sales projection update

**User Story:** As a reviewer, I want Venta_Bruta recorded in the projection file for the correct date, so that projections produce the day and month targets used by the REVISION document.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL prepare the Projection_File entry for the Business_Date using the computed Venta_Bruta value.
2. THE Corte_Santo_Workflow SHALL produce the projection outputs DIA, FECHA, META DE VTA, VENTA REAL, DIFERENCIA and % ALCANZADO for the Business_Date.
3. IF the configured monthly sales target (META DE VTA) for the Business_Unit and month is absent, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.
4. WHERE Projection_File write access is not confirmed, THE Corte_Santo_Workflow SHALL record proposed projection values without executing a Sheets write.

### Requirement 12: Bank statement import and AMEX pending collections

**User Story:** As a reviewer, I want AMEX deposits matched in the bank statement using the configured legend, so that pending AMEX collections reflect money earned but not yet deposited.

#### Acceptance Criteria

1. WHEN a Banorte or AMEX bank statement is provided for the Business_Date, THE Corte_Santo_Workflow SHALL register the statement as a document linked to the workflow_run.
2. THE Corte_Santo_Workflow SHALL identify AMEX deposits in the bank statement using the configured AMEX Statement_Legend in the configured statement column.
3. THE Corte_Santo_Workflow SHALL match expected AMEX settlements using the merchant-statement payment amount and payment date fields defined in configuration, applying the AMEX Deposit_Timing_Rule.
4. THE Corte_Santo_Workflow SHALL compute COBROS DE AMEX as the sum of AMEX amounts earned that have not yet settled by the Business_Date.
5. IF the `statement_legends` configuration does not define an AMEX deposit legend, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.

### Requirement 13: Per-channel pending collections (Falta por entrar en la cuenta)

**User Story:** As a reviewer, I want pending collections computed per channel using deposit-timing rules and statement legends, so that "Falta por entrar en la cuenta" is accurate per channel and per unit.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL compute a Pending_Collection amount for each Collection_Channel in the Business_Unit's configured Collection_Channel set.
2. WHEN computing COBROS DE BANORTE/TRANSFERENCIA, THE Corte_Santo_Workflow SHALL identify Banorte deposits using the configured Banorte Statement_Legend, sum the deposits, and derive the pending balance as the earned amount minus the deposited amount.
3. WHEN computing COBROS UBER, THE Corte_Santo_Workflow SHALL sum the Uber amount over the configured Uber settlement period (Monday–Sunday).
4. WHEN computing COBROS RAPPI, THE Corte_Santo_Workflow SHALL sum the Rappi amount over the configured Rappi settlement period (Friday–Thursday).
5. THE Corte_Santo_Workflow SHALL increase CXC only when a CXC entry is identified in the Wansoft close.
6. IF the `deposit_timing_rules` configuration is missing a settlement window for a Collection_Channel being computed, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.
7. IF a Collection_Channel requires a Statement_Legend that is absent from the `statement_legends` configuration, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.

### Requirement 14: Additional income and additional expenses

**User Story:** As a reviewer, I want additional income and additional expenses captured, so that non-recurring client transfers and domiciled charges are reflected in the review.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL record each additional-income item (client transfers such as reservations, deposits and events) with its amount and description.
2. THE Corte_Santo_Workflow SHALL record each additional-expense item (domiciled charges such as credit card payments, internet, Amazon and Spotify) with its amount and description.
3. WHERE a Business_Unit has Unit_Locale English (SANTO LA, SECO), THE Corte_Santo_Workflow SHALL represent additional expenses split into a DEBIT ACCOUNT list and a CREDIT ACCOUNT list, each item carrying date, description and amount.
4. THE Corte_Santo_Workflow SHALL include additional income and additional expenses in the Revision_Document section for the Business_Unit.

### Requirement 15: Daily adjustments capture

**User Story:** As a reviewer, I want daily adjustments recorded with observations, so that discounts, voids and cancellations are documented.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL record daily adjustments with concept, importe and observaciones for the categories Descuentos, Anulaciones and Cancelaciones.
2. THE Corte_Santo_Workflow SHALL preserve the free-text observation values associated with each adjustment.
3. THE Corte_Santo_Workflow SHALL include the AJUSTES DEL DÍA table in the Revision_Document section for the Business_Unit.

### Requirement 16: SALDOS (balances) finalization

**User Story:** As a reviewer, I want the balances block finalized using the unit's configured TOTAL formula, so that SALDOS reflects each unit's account structure correctly.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL populate the SALDOS block lines configured for the Business_Unit (for example PROV. AGUINALDOS, SALDO BANORTE, PROV. UTILIDADES, ACCIONES, Mifel, Peibo).
2. THE Corte_Santo_Workflow SHALL compute the SALDOS TOTAL using the TOTAL formula defined in the Business_Unit's Unit_Profile.
3. IF the Unit_Profile does not define a SALDOS TOTAL formula for the Business_Unit, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.
4. WHERE a Business_Unit has Unit_Locale English, THE Corte_Santo_Workflow SHALL render the balances block as BALANCE with BANK ACCOUNT and TOTAL rows.

### Requirement 17: REVISION output document generation

**User Story:** As an operations owner, I want a multi-unit REVISION document generated and saved to Drive, so that the daily review matches the real client output format instead of the placeholder fixture.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL generate a Revision_Document containing one section per Business_Unit included in the run, using each Business_Unit's configured section set.
2. THE Corte_Santo_Workflow SHALL include, for each Business_Unit section, a VTA POR DIA block with columns DIA, FECHA, META DE VTA, VENTA REAL and DIFERENCIA covering the Business_Date and the following day.
3. THE Corte_Santo_Workflow SHALL include, for each Business_Unit section, a VTA AL DÍA block with META DE VTA, VENTA REAL, DIFERENCIA and %DIFERENCIA, and a VTA META DEL MES block with META DE VTA, VENTA REAL and DIFERENCIA.
4. THE Corte_Santo_Workflow SHALL include, for each Business_Unit section, a SALDOS block, a FALTA POR ENTRAR EN LA CUENTA block, an AJUSTES DEL DÍA block, and additional income and additional expenses blocks, according to the Business_Unit's configured section set.
5. WHERE a Business_Unit is configured with monthly events tracking (for example Do Central), THE Corte_Santo_Workflow SHALL include a VTA EVENTOS MENSUAL block in that Business_Unit section.
6. THE Corte_Santo_Workflow SHALL include a corte-format status note for each Business_Unit section, using the configured Spanish note ("*FORMATO DE CORTE, BIEN" / "*FORMATO DE CORTE, OK") for Spanish units and the configured English note ("*DAILY SALES REPORT, OK") for English units.
7. WHEN the Revision_Document is generated, THE Corte_Santo_Workflow SHALL create a document record referencing the configured Drive output folder for the Business_Date, with the configured name pattern ("REVISION_CORTE_<date>").
8. IF the `drive_folder_map` configuration does not resolve an output folder for the Business_Unit and Business_Date, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.

### Requirement 18: Bilingual unit variation (ES/EN)

**User Story:** As a reviewer of international units, I want each unit rendered in its configured locale, so that SANTO LA and SECO use English without taxes while Mexican units use Spanish with IVA.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL determine the Unit_Locale for each Business_Unit from configuration.
2. WHERE a Business_Unit has Unit_Locale Spanish, THE Corte_Santo_Workflow SHALL render its section in Spanish and label amounts as "Cifras con IVA".
3. WHERE a Business_Unit has Unit_Locale English, THE Corte_Santo_Workflow SHALL render its section in English using the labels REVIEW, SALE OF THE DAY and DAILY SALES REPORT, and represent amounts without taxes.
4. WHERE a Business_Unit has Unit_Locale English, THE Corte_Santo_Workflow SHALL render the balances block with BANK ACCOUNT and TOTAL rows and render the expenses block with DEBIT ACCOUNT and CREDIT ACCOUNT tables.

### Requirement 19: Unit-configurable structure

**User Story:** As an operations owner, I want each unit's sections, channels, payment forms and formulas driven by configuration, so that the workflow is not hardcoded to a single unit.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL resolve each Business_Unit's Unit_Profile, including locale, Form_Of_Payment set, Collection_Channel set, Revision_Document section set and SALDOS TOTAL formula, from configuration.
2. IF a Business_Unit included in the run has no Unit_Profile in configuration, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception identifying the Business_Unit.
3. THE Corte_Santo_Workflow SHALL apply only the Form_Of_Payment set, Collection_Channel set and section set defined in each Business_Unit's Unit_Profile.
4. THE Corte_Santo_Workflow SHALL process multiple Business_Units in one run, each with its own Unit_Profile.

### Requirement 20: Registry spine, reviewers and event integration

**User Story:** As a system operator, I want every reconciliation to write to the registry spine and route exceptions to the configured reviewers, so that runs, tasks, documents, exceptions, events and watchdog state are auditable.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL create task records for email intake, evidence filing, terminal validation, cash validation, delivery validation, system cross-check, income-report registration, projection update, pending-collection computation and Revision_Document generation, each carrying a status.
2. WHEN an exception is recorded, THE Corte_Santo_Workflow SHALL assign the reviewer for that exception type from the `reviewer_map` configuration.
3. IF the `reviewer_map` configuration does not define a reviewer for a recorded exception type, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and record a missing-config exception.
4. WHEN the workflow_run reaches a terminal status, THE Corte_Santo_Workflow SHALL emit a corresponding event (`workflow_run.requires_review` or `workflow_run.ready_for_approval`) to the Registry_Spine.
5. THE Corte_Santo_Workflow SHALL write a watchdog_log entry recording the final reconciliation status and severity for the workflow_run.
6. WHEN reconciliation completes with no discrepancy exceptions and no other requires_review condition, THE Corte_Santo_Workflow SHALL set the workflow_run status to ready_for_approval.

### Requirement 21: AI safety boundary

**User Story:** As a compliance owner, I want the AI restricted to classification and review-package preparation, so that no high-risk external action is taken autonomously.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL limit AI actions to classifying, validating, summarizing and recommending.
2. THE Corte_Santo_Workflow SHALL produce review packages and logs rather than final external actions for any bank, SAT, payroll, IDSE, IMSS, legal, fiscal or government-portal step.
3. IF a step would require a bank, SAT, payroll, IDSE, IMSS, legal, fiscal or government-portal action, THEN THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review and route the step to a human reviewer.
4. WHILE the reconciliation outcome is uncertain, THE Corte_Santo_Workflow SHALL set the workflow_run status to requires_review instead of completed.

### Requirement 22: Reconciliation summary and round-trip integrity of structured figures

**User Story:** As a reviewer, I want a complete, machine-readable reconciliation summary that round-trips with the source figures, so that the review package is accurate and auditable.

#### Acceptance Criteria

1. THE Corte_Santo_Workflow SHALL produce a reconciliation summary containing, per Form_Of_Payment, the Cierre_Ter_Pla amounts, the Cierre_Sistema amounts and the computed difference.
2. THE Corte_Santo_Workflow SHALL include Total_Real, Total_Sistema, courtesy total, Venta_Bruta and each Pending_Collection amount in the reconciliation summary.
3. WHEN structured corte figures are serialized into the reconciliation summary and then parsed back, THE Corte_Santo_Workflow SHALL produce figures equivalent to the original input (round-trip property).
4. THE Corte_Santo_Workflow SHALL include the reconciliation summary in the workflow_run output regardless of terminal status.
