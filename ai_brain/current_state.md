# Current State

## 2026-07-13 - Bank deposits now settle the outstanding ledger

- AMEX Corte rows retain their gross sale amount while the AMEX export carries
  the separate net bank-match amount. A previously pending row is reconsidered
  when its payment date arrives; the old pending status no longer blocks an
  otherwise exact batch deposit.
- Banorte terminal deposits are applied FIFO to older open card-sale rows and
  may partially settle a day. The ledger carries only the residual instead of
  leaving the full day open when most of it has already landed.
- Uber and Rappi payouts close gross platform sales through the day before the
  payout. Their net bank amount is not compared directly with gross Corte sales,
  because platform deductions would otherwise remain falsely outstanding.
- Positive `COM. PAG. DCC` and `IVA PAG. DCC` rows are traced as non-operating
  commission credits instead of unclassified sales deposits.
- A read-only production rehearsal against the July 12 AMEX/Banorte uploads
  produced AMEX 162,908.39, Banorte 4,580.90, Rappi 5,335.00, Uber 0.00 and
  named CxC 17,230.00, with 15 matches and no parser exceptions.

## 2026-07-13 - Outstanding ledger, manual balances and bank UX repaired

- `Falta por entrar` now renders only AMEX, Banorte, Uber, Rappi and named
  CxC. Debit and credit roll up once into Banorte; cash is never bank-pending.
- The latest bank snapshot remains authoritative through its reconciliation
  date, while newer canonical Corte days are added once until another bank
  snapshot clears them. Platform balances therefore carry forward and are
  subtracted only by a later bank reconciliation.
- Legacy `corte_receivables` rows that mirrored daily payment channels are
  retired as settled audit history. Agent Mail no longer creates them, and the
  bank watcher rejects any surviving `evidence.kind=channel_sales` rows. The
  table is again reserved for real CxC lifecycle items.
- The production July 9 snapshot was repaired to the allowed channel set. Open
  CxC now consists only of Diego Villanueva, La Valisse and Otro (MXN 17,230).
- Manual balances saved in `/saldos` are read as the latest global SANTO
  balance and appear consistently in both `/cortes` and `/socios`.
- Conciliation groups editable channels by terminals, cash/transfers,
  platforms and complements. Supervisor approval has an immediate pending
  state, and bank uploads expose upload/progress/result states with polling.
- The duplicate-Corte warning was removed from the supervisor Corte screen;
  internal deduplication remains active.

## 2026-07-09 - Financial questions use deterministic period-aware rules

- `/api/cortes/ai` now resolves the period stated in the question (including
  explicit ranges and month-end questions), queries canonical Corte records,
  CxC lifecycle rows and all persisted bank reconciliations, and calculates
  supported answers before producing them. An AI fallback interprets equivalent
  natural-language questions from the same compact, verified financial facts.
- Incomplete months are identified from daily-record coverage; a month-end
  request returns a plain-language incomplete-close response rather than a
  fabricated monthly result. Missing bank-origin links return an explicit
  plain-language data gap, never an estimated deposit or commission.
- Historical-month pending questions use the latest bank state for the month's
  source sales; once all June collections have landed in July, the response is
  `$0.00 (Ya ingresó todo al banco)`.

## 2026-07-09 - Daily sales and payment-channel answers read Corte directly

- A question about a selected business day reads its canonical Corte record
  directly for gross sales and for American Express, cash, debit, credit, Uber
  Eats and Rappi. These answers do not wait for a bank reconciliation and are
  always shown as MXN.

## 2026-07-09 - Manual CxC breakdown is ledger-backed

- The outstanding balance now prefers open `corte_receivables` items over a
  stale aggregate CxC figure in the bank snapshot, preventing double-counting.
- Manual outstanding CxC may be recorded as named, auditable ledger items and
  is rendered item-by-item in both `/socios` and `/cortes`.

## 2026-07-08 - Corte outstanding ledger semantics corrected

- Confirmed `Falta por entrar` source of truth: daily Corte sales by source
  date, carried forward as item-level ledger rows and subtracted only when bank
  deposits are detected. AMEX export rows enrich Corte-created ledger items
  with net/payment-date details but no longer create duplicate pending items.
- Bank watcher/reconciliation now keeps pending channels to AMEX, Banorte,
  Uber, Rappi and itemized CxC. Cash, PayPal and transfers are no longer
  reconstructed as bank-pending balances from `income_register`.
- Banorte CSV parsing now supports the real accented headers, classifies the
  observed Rappi SPEI that previously became unclassified, and returns
  additional expenses as non-commission/non-IVA withdrawals for the relevant
  bank business date.
- Dashboard outstanding summaries now prefer ledger `amount` over AMEX net
  `expected_deposit` and normalize old labels such as
  `amex_neto_pendiente`/`banorte_terminal_pendiente` back to channel names.
- Regression tests cover AMEX dedupe/canonical Corte source, Banorte group
  clearing, separate Uber/Rappi pending ledgers and Banorte additional expenses.
  Watch item: direct Corte AI answers that inspect `pending_collections` may
  need wording updates if they expected the old synthetic labels.

## 2026-07-07 - Outstanding bank carry-forward and current-day forecast repaired

- Bank watcher reconstruction now starts from the latest persisted
  `bank_reconciliation.pending_items` snapshot and adds only newer Corte days.
  Items matched by a later statement are no longer recreated from the original
  income register, and an empty snapshot remains authoritative instead of
  reviving an older non-empty balance.
- `/cortes` now resolves the selected day's forecast from the registered
  monthly Forecast document, including the synthetic current-day row before a
  real Corte exists, and uses the same global outstanding snapshot as `/socios`.
- Regression tests cover settled historical items, new pending items and empty
  authoritative snapshots. Dashboard production build passes locally.
- Production inspection found no `workflow_runs` or `corte_daily_records` row
  for 2026-07-06. Agent Mail run `28885635127` recovered the source email and
  created the run plus canonical daily row: Venta Bruta 108,836.26, Total Bruto
  121,123.55 and forecast 35,511.06. It remains `waiting_for_input` because the
  reconciliation difference is 535.00 and requires human review.
- The Corte AI endpoint again answers deterministic questions directly for
  daily sales, daily forecast, live outstanding balance and monthly channel
  totals. The current-day UI passes its real business date/month even when the
  selected row is the non-persisted `stub-today`; narrative questions retain
  the compact Claude/Gemini fallback.
- The registered Forecast documents stop at June, but the recovered July 6
  run carries the complete 31-row July projection. `/cortes` and direct AI
  forecast answers now use that monthly carrier for the synthetic July 7 row;
  its confirmed target is 57,686.09 while observed sales remain absent.

## 2026-07-06 - AI Questions System Completed

- Implemented 25 predefined financial questions with pattern matching and direct SQL queries.
- The AI endpoint `/api/cortes/ai` now tries direct SQL answers first (fast, free) before falling back to LLM (Claude/Gemini).
- 20/25 questions use direct SQL queries against `corte_daily_records`, `workflow_runs.output_payload` and `corte_receivables`.
- 5/25 questions (Q8, Q9, Q15, Q16 - complex cross-month analysis) fall back to LLM with full context.
- Pattern matching supports Spanish variations ("depositó", "depositaron", "AMEX"/"American Express").
- Questions work in both `/cortes` dashboard and `/socios` views.
- File `apps/dashboard/src/app/api/cortes/ai/route.ts` cleaned from 572 to 478 lines (eliminated ~100 lines of duplication).
- Questions categories: Daily deposits (Q1-Q4), CxC (Q5), Cash/Tips (Q6-Q10), Monthly deposits (Q11-Q14), Cross-month (Q15-Q16), Commissions (Q17, Q22-Q23), Platform sales (Q18-Q21, Q24-Q25).
- Estimated cost savings: 80% reduction (~$180/month per unit for 100 questions/day).
- Speed improvement: 10-30x faster for direct SQL questions (< 100ms vs 1-3 seconds).
- Reference Python implementation exists at `services/ai/questions.py` with 25/25 tests passing in `services/ai/test_questions.py`.
- Documentation: `TEST_25_PREGUNTAS.md`, `SISTEMA_PREGUNTAS_IA_LISTO.md`, `services/ai/README.md`, `docs/03_execution/sistema_preguntas_ia_resumen.md`.

## 2026-07-03 - July 1 restored and review UI compacted

- Reconstructed the missing canonical daily row for 2026-07-01 from its
  persisted workflow income channels: Total Bruto MXN 129,454.40, Propinas
  MXN 11,447.40 and Venta Bruta MXN 118,007.00.
- Conciliacion now opens only the latest day by default and uses a responsive
  channel editor instead of a wide table. Agent Mail attachments are hidden
  until storage delivery is reliable; the original email body remains visible.
- The same channel editor is now available in the main Cortes day view as well
  as the detail page.
- Removed per-document signed URL generation from dashboard reads, eliminating
  unnecessary Storage calls during day/month navigation.

## 2026-07-03 - Forecast source discipline and supervisor review

- Socios selects one consistent monthly target source for KPI and charts and
  never treats Forecast workbook values as observed sales. Rebased prior-month
  sales can no longer appear as future daily sales.
- Manual Corte corrections now update the canonical `corte_daily_records` row,
  recompute `total_bruto` and `venta_bruta`, and preserve an audited workflow
  correction event.
- Agent Mail now persists the email body and links the email plus attachments to
  the workflow run. Conciliacion and Corte detail expose editable channel values,
  the original email and signed evidence links.
- Drive workbook discovery now requires the exact business month. A missing July
  workbook returns review instead of modifying June. Automatic month-template
  creation remains pending as a separate controlled workflow.

## 2026-07-02 - Corte daily-record stabilization started

- Added a proposed `corte_daily_records` migration with one unique row per
  restaurant/date and explicit channel, `venta_bruta`, `total_bruto`, forecast
  and source-version fields. The migration has not yet been applied remotely.
- Confirmed from historical Ingresos evidence that `Total Bruto` is the payment
  channel total and `Venta Bruta = Total Bruto - Propinas`; Forecast and Socios
  must use Venta Bruta rather than reconciliation `total_real`.
- Added an idempotent, dry-run-first historical workbook importer and dual-write
  support for future Agent Mail Cortes. Existing workflow-run JSON remains as a
  compatibility/audit path.
- Dashboard data loading now prefers canonical daily records when available and
  can expose historical days without synthetic workflow runs.
- CxC creation/settlement events now have a canonical `corte_receivables`
  lifecycle ledger; item-level expected bank collections remain pending.

## 2026-07-03 - Historical Ingresos dry run validated

- Production Supabase project was confirmed through the connected environment,
  but the connected Supabase account initially had no permission for that
  project and no replacement service key is available in the local environment.
- Parsed 10 supplied Ingresos workbooks under
  `C:\Users\dchac\Downloads\SANTO`: 304 unique daily records from 2025-06-01
  through 2026-05-31.
- Validated zero duplicate dates and zero mismatches for
  `Venta Bruta = Total Bruto - Propinas`. The single zero-sales record is
  2025-12-25 and is retained as a real closed day.
- The importer now supports the real layered workbook headers and explicitly
  rebases stale internal dates from the month/year in the filename. This fixes
  the January 2026 workbook whose cells still contain January 2024 dates.
- Missing supplied months remain visible gaps: August and September 2025, plus
  June 2026 onward.
- Supabase access was restored and migration `corte_daily_records` was applied
  to the production project. All 304 validated rows were imported in
  idempotent batches and re-queried successfully.
- Remote totals exactly match the local source audit: Venta Bruta
  `32,862,233.35`, Total Bruto `36,481,635.50`, Propinas `3,619,402.15`, with
  zero duplicate dates and zero formula mismatches.
- Migration `harden_set_updated_at_search_path` fixed the Supabase advisor
  warning for the shared updated-at trigger function. Remaining security
  advisor warnings concern pre-existing Santo Private booking policy and Auth
  leaked-password protection, outside this Corte migration.

## 2026-07-03 - Global outstanding card corrected

- Socios now computes `Falta por entrar hasta hoy` independently from the
  selected day. It uses the latest non-empty bank/revision outstanding snapshot
  for the selected unit on or before today and displays its reconciliation
  cutoff date.
- Production data currently yields MXN 70,815.24 with a cutoff of 2026-06-29.
  Runs for 2026-06-30 and 2026-07-01 contain neither expected collection items
  nor a bank reconciliation snapshot, so those amounts cannot be inferred
  safely and remain an upstream persistence gap.

Last updated: 2026-06-24.

## Active Handoff

For the in-flight Corte Santo full-workflow effort (payment-form reconciliation,
Excel + vision extraction, bank statement parsing, dashboard simplification,
Vercel/Supabase deploy, validated against the real 2026-06-04 test set), see
`ai_brain/handoff_corte_santo_full_workflow.md`. That file is the fastest way to
resume in a fresh conversation.

## Repository Status

- Repo folder exists at `C:\Users\dchac\Documents\Codex\SantoOS`.
- Git has been initialized.
- Raw intake folder exists at `00_INBOX_SANTO_RAW/`.
- Two client source HTML files were dropped into the intake folder:
  - `santo_ai_os_p0_prd_v2_es_final (1).html`
  - `santo_ai_os_p0_especificacion_tecnica_v2_es_final.html`
- Clean Markdown docs have been created under `docs/`.
- AI development memory has been initialized with `AGENTS.md`, `CLAUDE.md`, `santo_context.md` and `ai_brain/`.
- Client Claude Project Instructions, the Santo AI OS need-to-know guidance and the latest client sprint conversation have been reconciled into repo memory:
  - P0 PRD/spec win over long-term Claude instructions when scope conflicts.
  - Current sprint is a foundation sprint, not full P0 completion.
  - Active P0 remains Corte Santo plus thin XML SAT and Utilities validations.
  - Employee Document Intake is future/P3+ unless Santo explicitly reintroduces it.
  - DRY/MECE skill registry checks are required before creating new workflow modules.
  - Progressive context loading is required so `santo_context.md` stays lightweight.
  - Operational Addendum is confirmed configuration, not architecture.
- P0 repo foundation has been scaffolded:
  - `.env.example` with placeholders only.
  - Expanded `.gitignore` for env files, Python, Node/Next.js and local editor noise.
  - `apps/dashboard/` placeholder.
  - `services/command_handler/` placeholder.
  - `services/agent_mail/` placeholder.
  - `supabase/` migration placeholder.
  - `workflows/` module rules, skill template and executable `_template` module.
- PR 2 Supabase registry spine has been drafted offline:
  - `supabase/migrations/20260527132500_p0_registry_spine.sql`
  - Explicit tables for domains, workflows, workflow_runs, documents, tasks, exceptions, reviews, approvals, watchdog_log, events and email_messages.
  - Supporting registries for people, vendors, restaurants, legal entities and Drive folder map.
  - RLS enabled on every P0 table.
  - Authenticated read policies and service-role write grants.
  - Seed placeholders marked `[CONFIRM]` for unconfirmed operational inputs.
  - Idempotency/deduplication constraints for workflow runs, email messages and documents.
- PR 3 dashboard shell has been scaffolded:
  - Next.js 16 + TypeScript app under `apps/dashboard/`.
  - Supabase SSR client wrapper using publishable/anon keys only.
  - Role shell reads operational role from Supabase `app_metadata`, not user-editable metadata.
  - P0 dashboard home shows Corte Santo, exceptions, reviews and Agent Mail activity.
  - Missing Supabase config displays as `requires_config`/review state instead of failing silently.
  - Magic-link sign-in route and auth callback route exist.
  - `postcss` override patches the current `npm audit` advisory without downgrading Next.
- Dashboard Corte Santo supervisor simplification is in progress:
  - `/cortes` now presents a unit -> month -> week -> day supervisor flow with
    simple daily figures, forecast comparison, comments, manual correction
    capture, bank-validation status and bank upload/approval actions.
  - `/archivos` now presents a Drive-oriented files view grouped by Cortes,
    Bancos, monthly Excel and Forecast, with monthly forecast upload.
  - The dashboard now treats forecast as a real monthly source: it recognizes
    registered forecast documents and workflow `drive_file_ids.forecast`, uses
    the matching daily forecast row instead of the accumulated monthly target,
    and avoids showing forecast deltas when the source is missing.
  - Duplicate Agent Mail runs for the same business date are collapsed in the
    supervisor views to the most complete run, while still warning that
    duplicates exist.
  - `/archivos` now keeps the monthly forecast above the day folders and groups
    daily Corte/Bancos/Excel/Evidencia by inferred business date.
  - Gemini question UI now calls a server-side `/api/cortes/ai` endpoint using
    `GEMINI_API_KEY`; it answers about the selected corte only and does not
    approve or execute any external action.
- PR 4 shared command handler core has been implemented:
  - Python package under `services/command_handler/`.
  - Structured command envelope validation for dashboard, Agent Mail, scheduler and future WhatsApp.
  - P0 phase discipline.
  - Actor role checks.
  - Workflow registry checks.
  - Deterministic idempotency keys.
  - Event and watchdog records returned for future Supabase persistence.
  - Pending workflow config returns `requires_review`.
- PR 5 Agent Mail intake/classification core has been implemented:
  - Python package under `services/agent_mail/`.
  - Structured email metadata is converted to an `email_messages`-shaped record.
  - Confirmed subject-prefix routing can produce command handler envelopes.
  - Missing/unconfirmed/ambiguous routing returns `requires_review`.
  - Confirmed ignore prefixes can mark messages as `ignored`.
  - No live Gmail polling has been implemented yet.
- PR 6 partial Corte Santo intake module has been implemented:
  - Workflow module under `workflows/corte_santo/`.
  - Includes `skill.md`, `script.py`, `config.example.json`, fixtures and tests.
  - Accepts one restaurant/date and submitted document metadata.
  - Produces proposed workflow_run, documents, tasks, exceptions, events and watchdog_log records.
  - Missing restaurant, Drive folder map, mandatory attachments, reviewer map, thresholds or source hashes return `requires_review`.
  - Final reconciliation logic is intentionally not implemented because PR 7 inputs are still pending.
- PR 8 partial XML SAT validation module has been implemented:
  - Workflow module under `workflows/xml_sat_validation/`.
  - Includes `skill.md`, `script.py`, `config.example.json`, generated fixture and tests.
  - Parses XML locally and extracts UUID, issuer RFC, receiver RFC, total and issue date.
  - Rejects unsafe DOCTYPE/entity declarations.
  - Validates RFCs only against provided config.
  - Missing RFC map, Drive folder map, trusted source exports or XML text returns `requires_review`.
  - No SAT/FIEL/government portal automation is implemented.
- P0 meeting demo and Drive connector have been implemented:
  - Dashboard demo now presents Corte Santo, XML SAT and Utilities as one P0
    operating model.
  - The demo shows Agent Mail intake, workflow records, Drive evidence,
    exceptions and human review as one traceable flow.
  - `services/drive_connector/` provides a configurable Google Drive upload
    boundary with `dry_run`, confirmed-folder enforcement, Shared Drive
    support and audit event output.
  - Agent Mail can hand classified attachments to the Drive connector when
    `GOOGLE_DRIVE_CONNECTOR_CONFIG` is configured.
  - Unknown folders, unconfirmed folder maps and missing credentials return
    `requires_review`.
  - Live Drive writing still depends on confirmed folder IDs/permissions and
    runtime credentials from Santo.
  - Meeting guide exists at `docs/03_execution/p0_alonso_demo.md`.
  - Corte reconciliation no longer contains invented fallback tolerances;
    missing threshold or severity configuration returns `requires_review`.
- Corte Santo workflow redesigned to match the client's real process and output
  (ADR-0009):
  - `reconcile` now compares `cierre_terminal` ("Cierre Ter/Pla") against
    `cierre_sistema` ("Cierre Sistema") by confirmed `payment_forms`
    (Amex, Banorte debit/credit, efectivo, transferencia, Uber Eats, Rappi,
    PayPal), rolling forms up into report groups and flagging any group or
    Total Real vs Total Sistema difference above
    `thresholds.reconciliation_tolerance`.
  - `build_revision_document` produces the structured `REVISION` report per unit
    (VTA POR DIA, VTA AL DIA, VTA META DEL MES, SALDOS, INGRESOS/GASTOS
    ADICIONALES, FALTA POR ENTRAR EN LA CUENTA, AJUSTES DEL DIA), matching the
    client format provided in `00_INBOX_SANTO_RAW`.
  - Config requirements changed: `payment_forms` is now required and
    `thresholds` uses `reconciliation_tolerance`; `config.example.json`,
    fixtures, tests and command-handler registry fixtures were updated.
  - The dashboard Corte Santo PDF generator now renders the REVISION format from
    `workflow_run.revision_document`; the previous placeholder PDF and its
    broken `startxref`/`{streamContent}` assembly were fixed via a shared
    `assembleSimplePdf` helper.
  - Exact thresholds, severities, full per-unit roster and reviewer routing
    still require Santo confirmation.
- Corte Santo Excel extraction (Option B) added (ADR-0010):
  - `workflows/corte_santo/corte_excel_parser.py` reads the corte workbook
    read-only (`data_only`, openpyxl) and extracts Cierre Ter/Pla and Cierre
    Sistema by mapping column headers to reconciliation groups via config
    (`excel_layout`, with a shipped default).
  - `script.run` auto-extracts figures when structured `cierre_terminal`/
    `cierre_sistema` are absent and a `corte_excel`/`daily_sales_report`
    document carries a `source_path`.
  - Any unmapped column, missing file or missing openpyxl raises
    `extraction_requires_review` and forces `requires_review`; money is never
    silently dropped.
  - `payment_forms` standardized on report groups (amex, bancos, efectivo,
    transferencia, plataformas); config, fixtures and tests updated.
  - Confirmed P0 inputs so far: reconciliation tolerance = 0; only the SANTO
    unit is active.
- Corte Santo canonical evidence layer added (ADR-0012), based on the 35-page
  `Corte Santo.pdf` operating procedure:
  - Vision extraction and Banorte statement parsing are now called by the
    primary `script.run` path when their evidence is supplied.
  - Reconciliation values are separated from monthly Ingresos registration
    values.
  - The Corte template's repeated cash amount is no longer counted as a cash
    tip, preventing cash from being doubled.
  - Dish courtesy is added to cash only for the Ingresos registration view.
  - AMEX/bank photo totals and the lower-tip rule produce traceable checks and
    `requires_review` on mismatches.
  - The supplemental Total Sistema block now supplies Transferencia/Uber/Rappi
    system totals; the real 2026-06-04 Corte Excel reconciles at exactly
    75,685.10 vs 75,685.10 with difference 0.
  - Operating requirements and the full-automation completion gate are tracked
    in `docs/04_workflows/corte_santo_operating_procedure.md`.
- Corte Santo two-stage automation contracts added (ADR-0013):
  - Stage 1 writes Ingresos in yellow and Forecast, updates verified Drive
    workbooks, notifies the supervisor and waits for AMEX/Banorte.
  - A Drive watcher emits `workflow.resume` only when both bank files exist.
  - Stage 2 matches expected collections, updates REVISION, marks Ingresos blue,
    updates Drive and notifies the supervisor.
  - Missing inputs, reviewed stages and failed live deliveries cannot become
    `completed`.
  - Confirmed supervisor recipient: `developer@santorestaurants.com`.
  - Supplied Corte/REVISION Drive folder ID:
    `1sN9QP54zdwgprH0-LUJwCVLtd4OY9vsL`; its role as bank watcher folder is
    still pending confirmation.
  - The supplied Forecast is confirmed as the June projection template. Its 30
    projection amounts were correct but its date cells were stale May dates;
    the writer can now safely rebase a confirmed complete projection series to
    the Corte month before writing Venta Real.

## Corte Santo E2E Test: 2026-06-04

- Sent a real Agent Mail message with the six operating attachments.
- Agent Mail received and classified it as `[CORTE]`.
- Reconciliation passed exactly: Total Real = Total Sistema = 75,685.10.
- The Bancarias photo is now treated as aggregate Banorte evidence
  (`consumo`, `propina`, `total`) only. Debit/credit split is taken from the
  Corte Excel `T Debito` and `T Credito` columns:
  `debito = 5,130.25`, `credito = 52,061.90`.
- The Bancarias vision prompt now sums all visible tickets in the photo. The
  2026-06-04 photo validates against the Corte Excel at `57,192.15` with
  difference `0.00`.
- Controlled Ingresos copy was written yellow for June 4.
- Forecast projections were preserved, dates rebased to June, Venta Real
  75,685.10 written for June 4, and monthly subtotal formulas verified.
- Real AMEX `.xls` and Banorte `.csv` parsed successfully.
- Bank stage validated with one AMEX match and 118,694.79 remaining as
  legitimate pending AMEX collections.
- Controlled Ingresos copy was changed from yellow to blue.
- Initial and final supervisor notifications were sent to
  `developer@santorestaurants.com`.
- The connected Drive identity is `dantecastelaou@gmail.com`. Google returns
  `404 File not found` for the supplied folder, so it has not been shared with
  that identity and the watcher could not autonomously observe the bank
  uploads. Live Drive workbook replacement and Supabase resume persistence
  remain unverified.
- Repeated local poller runs can exhaust Gemini free-tier quota and return
  `429 Too Many Requests`. The vision extractor now retries transient Gemini
  failures and spaces batch requests, but production should use paid Gemini or
  another stable vision provider before declaring the workflow fully automated.
- Corte Santo Drive discovery now uses a stable configured folder instead of
  requiring the operator to know individual workbook file IDs. Confirmed root
  folder for the current E2E track:
  `1CkIvNSE1B2SzCyzWOWtSd0j11np-ZJsM`. The runtime discovers Ingresos and
  Forecast by filename/month signals inside that folder tree. The bank watcher
  accepts flexible AMEX/Banorte filenames and can sample file contents when the
  name is generic.
- Local verification could not list the new Drive folder because the current
  shell did not have `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` and
  `GOOGLE_DRIVE_REFRESH_TOKEN` loaded. Vercel/local runtime must have those
  env vars and the folder must be shared with that Google identity.
- A Vercel Cron entrypoint now exists at `/api/cron/santo` with one configured
  cron (`*/15 * * * *`) that defaults to Agent Mail intake and can manually run
  the bank watcher through `services.scheduler.corte_santo_cron`. The endpoint
  requires `CRON_SECRET`. Live writes require `SANTO_CRON_WRITE=true`; otherwise
  the scheduler runs dry. Full bank-stage automation still requires persisting
  the stage-1 expected-collections/resume payload in Supabase.
- GitHub Actions Agent Mail intake runs every 15 minutes with a 60-minute
  lookback window and a workflow-level concurrency lock. The poller checks
  Supabase for an existing `email_messages(provider, provider_message_id)`
  record before classification, attachment download, Drive writes or Corte
  automation, so messages already handled once are skipped on later lookback
  passes.
- Agent Mail polling explicitly requests `include_unauthenticated=true` so
  trusted allowed senders whose domains are missing inbound auth headers can
  still enter SantoOS review gates. Intake also stores a normalized
  `message_content_fingerprint` based on subject and attachment metadata so a
  forwarded copy of the same Corte package is skipped after the original has
  been recorded.
- Corte evidence handling now classifies `AJUSTE DE CXC...`/`CXC...` photos as
  `cxc` vision inputs, checks the extracted CXC total against the Bancos
  reconciliation difference, and prompts AMEX vision to sum all visible AMEX
  tickets instead of extracting only one ticket.
- P0 workflow documentation now follows the workflow-skill Markdown convention
  from ADR-0015: each workflow `skill.md` starts with YAML frontmatter, and the
  P0 workflow folders plus `_template` include `index.md` and `log.md` for
  human/Claude navigation.
- Corte Santo bank reconciliation was refined after the 2026-06-17 bank watcher:
  Banorte deposits matching configured `ignore_deposit` keywords such as
  `ABONO DCTO. CARTERA` are traced but excluded from operational deposits, and
  consolidated AMEX SPEI deposits can match multiple AMEX expected-payment rows
  sharing the same expected payment date.

## Processed Context

Processed from raw HTML into Markdown:

- P0 PRD: `docs/01_product/p0_prd.md`
- P0 technical spec: `docs/02_architecture/p0_technical_spec.md`
- North star: `docs/00_north_star/santo_ai_os_north_star.md`
- Safety boundaries: `docs/06_security_approvals/p0_safety_boundaries.md`
- Pending inputs: `docs/99_pending_inputs/p0_operational_inputs_pending.md`
- Need-to-know execution guidance: `docs/03_execution/need_to_know_for_dante.md`
- First sprint alignment: `docs/03_execution/first_sprint_alignment.md`

Original raw files remain in `00_INBOX_SANTO_RAW/`.

## Next Recommended Step

Activate and validate the Corte two-stage runtime in production:

1. Confirm supervisor email, active Ingresos/Forecast Drive file IDs and the
   AMEX/Banorte watcher folder ID.
2. Configure stable Drive, Agent Mail and Supabase runtime credentials.
3. Persist the expected-collections ledger and resume payload against the
   original Supabase workflow run.
4. Deploy the initial-stage intake runner and Drive watcher.
5. Execute one real end-to-end daily email through the bank-upload stage and
   verify workbook contents, REVISION, notifications and Supabase audit records.

## Not Started

- Supabase migration has not been applied to a live/local database yet.
- Two-stage Corte production runtime contracts exist and have a Vercel cron
  HTTP trigger, but full bank-stage resume still needs the persisted stage-1
  ledger in Supabase.
- Live Agent Mail polling can now be invoked by the Vercel cron endpoint once
  the production deployment has `CRON_SECRET`, Drive OAuth env vars and
  `SANTO_CRON_WRITE=true` if live Supabase writes are desired.
- Dashboard has live Supabase query wrappers but no deployed Supabase env/session yet.
- No dashboard component tests yet.
- Corte reconciliation now compares Cierre Ter/Pla vs Cierre Sistema by payment
  form and builds the REVISION document, but exact thresholds, severities, the
  full per-unit roster and reviewer routing remain pending Santo confirmation.
- Utility receipts thin workflow exists, but final template rules, folder mapping
  and Sheets scope remain pending.
- Drive connector now supports durable Google OAuth refresh-token credentials.
  The Vercel app connector returned `403 Forbidden`, but the local Vercel CLI is
  authenticated. `vercel env ls` for the linked `apps/dashboard` project does
  not show `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` or
  `GOOGLE_DRIVE_REFRESH_TOKEN`, so the Drive OAuth env vars still need to be
  added to that exact project/environment before live watcher verification.

## Verification

- `python -m pytest` passes for the workflow template contract.
- Workflow template smoke test returns `requires_review` when example config still contains `[CONFIRM]` values.
- Supabase registry spine has offline contract tests for required tables, RLS, idempotency and secret-pattern detection.
- Supabase CLI and `psql` are not installed locally; Docker is installed but the Docker daemon was not running, so SQL execution against Postgres has not been verified yet.
- Dashboard verification:
  - `npm run lint` passes in `apps/dashboard`.
  - `npm run build` passes in `apps/dashboard`.
  - `npm audit --audit-level=moderate` passes in `apps/dashboard`.
- Browser check at `http://localhost:3000` showed the P0 dashboard with config-pending state and no console errors.
- Browser check at `/auth/sign-in` showed magic-link sign-in disabled until Supabase env is configured and no console errors.
- Command handler verification:
  - `python -m pytest` passes.
  - Pending registry smoke test returns `requires_review`.
  - Confirmed registry smoke test returns `accepted` with queued workflow run status.
- Agent Mail verification:
  - Confirmed routing smoke test classifies `[CORTE]` and emits a `workflow.intake` command.
  - Pending routing smoke test returns `requires_review`.
- Corte Santo intake verification:
  - `python -m pytest workflows/corte_santo/` passes with 27 tests.
  - Smoke test with `config.example.json` returns `requires_review`.
  - Dashboard `npm run lint`, `npm run build` and `npm audit --audit-level=moderate` pass.
  - Secret-pattern search found no real Supabase JWT/project URL material outside ignored build/dependency folders.
- The repo now constrains Python to `>=3.11,<3.14`; the previously selected
  Python 3.14 alpha runtime emitted native numpy/openpyxl shutdown crashes even
  after passing tests.
- XML SAT verification:
  - `python -m pytest` passes.
  - Smoke test with `config.example.json` returns `requires_review`.
  - Confirmed-config tests validate generated CFDI metadata locally.
- Drive connector verification:
  - Confirmed demo config produces a proposed Drive document and audit event
    in `dry_run`.
  - Unconfirmed folders and missing credentials return `requires_review`.
  - OAuth refresh-token credentials are exchanged for a fresh access token in
    tests; live Drive credentials have not been printed or persisted in repo.
- Corte two-stage verification:
  - Controlled workbook tests verify yellow-to-blue Ingresos updates and
    Forecast formula updates.
  - AMEX named-column parsing and transaction-based Banorte matching pass.
  - The Drive watcher waits for both bank files and rejects duplicates.
  - Runtime delivery gates prevent success notifications on reviewed stages and
    downgrade failed Drive updates to `requires_review`.
- Corte Agent Mail production verification:
  - Vision extraction now caches successful image reads by attachment
    `source_hash`, document type, provider/model and prompt/schema hash.
  - GitHub Actions restores `.cache/corte_santo_vision` for Corte Agent Mail,
    bank watcher and manual reprocess runs.
  - Run `27882873008` on `2026-06-20` used the updated production
    `GEMINI_API_KEY` metadata but still received Gemini `429 Too Many Requests`
    from `gemini-2.5-flash`; the run completed as `requires_review`.
  - Local OCR via Tesseract is now installed in Corte GitHub Actions and used
    before any model call for AMEX, Bancarias and CXC, with Gemini fallback
    disabled in the confirmed config. Run `27909801448` on `2026-06-21`
    completed without Gemini/429; AMEX matched the Excel total, while
    Bancarias and CXC OCR still require parser/rule refinement or review.
  - Run `27910052864` on `2026-06-21` confirmed CXC evidence no longer inflates
    the income register: `debito` remained `10027.51` and `propinas` fell back
    to terminal tips at `10776.65`; Drive updates completed, but the run still
    returned `requires_review` because Bancarias OCR and CXC-vs-difference checks
    need refinement/review.
  - Run `27913862840` on `2026-06-21` reprocessed SANTO `2026-06-17` using the
    most complete duplicate package, Excel cash adjustments and normalized CXC
    OCR. It wrote `debito=6328.75`, `efectivo=5770.0`, `propinas=9120.41`, and
    matched CXC `2754.25` against the Bancos difference without Gemini/429.
  - Run `27914000865` on `2026-06-21` processed SANTO `2026-06-20`
    (`received_at=2026-06-21T07:25:27Z`) after the scheduled workflow missed
    the 60-minute lookback window. The Agent Mail cron now uses a 36-hour
    lookback and 50-message limit so delayed/dropped GitHub schedules can still
    pick up unprocessed daily Corte emails through idempotency.
- To reduce GitHub Actions minutes while workflows scale, Corte Agent Mail now
  runs once daily at `09:00 UTC` (`06:00` Argentina) with the 36-hour lookback.
  Corte Bank Watcher is manual-only for now.
  - Dashboard now includes a `/conciliacion` operator view for the Corte two-stage
  gate: it shows the Agent Mail output for recent Corte runs, records supervisor
  approval through `reviews`/`approvals`/`events`, uploads AMEX and Banorte files
  to the configured Drive bank folder, registers the documents in Supabase and
  dispatches the `corte-santo-bank-watcher.yml` workflow. Missing Drive or
  GitHub configuration is recorded as `requires_review` instead of pretending
  the bank stage ran.
- Corte Santo evidence rules now handle the corrected 2026-06-20/22 CxC
  transfer/PayPal pattern without Gemini. A new `$245` principal is recognized
  on opening, while settlement contributes only its `$513` tip, producing
  `=245+3078-2565`. Cash settlement produces `=245-245`. The email body is
  authoritative for lifecycle intent and images provide amount/channel/tip
  evidence. AMEX can use a configured tiny photo override tolerance
  (`income_photo_override_tolerance=0.1` in confirmed config), and local OCR now
  reads `detalle_efectivo` courtesy/direction amounts for cases such as
  2026-06-19 cash.

## 2026-07-03 - CxC lifecycle stabilized from corrected June workbook

- Added deterministic email-body parsing for CxC openings and settlements.
- Opening principal enters PayPal once; settlement principal is not counted
  again and only a newly known tip affects PayPal/Propinas.
- Added `corte_receivables` with stable movement identity, RLS and source
  evidence. Backfilled the confirmed June 24, 27 and 29 openings: five rows,
  MXN 3,720 total open principal.

## 2026-07-05 - P0 audit hardening

- Financial and execution surfaces now enforce Supabase Auth and explicit role
  allowlists. Anonymous `/socios`, Corte AI, workflow trigger and sandbox
  access were removed.
- The implicit NVIDIA/DeepSeek AI fallback was removed pending provider
  governance approval.
- Scheduler, Agent Mail and Vercel cron now calculate restaurant dates in
  `America/Mexico_City`; UTC remains the timestamp transport convention.
- CI now runs Python tests, dashboard lint and dashboard build. Local
  verification passes with 150 Python tests, lint warnings only and a clean
  production build.
- Audit blocker still requiring owner action: the active Supabase service key
  matches the key exposed in Git history, and the GitHub repository remains
  public. Rotate the key in Supabase/local/Vercel/GitHub and make the repository
  private before operational acceptance.
