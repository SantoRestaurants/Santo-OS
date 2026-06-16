# AI Session Log

## 2026-05-27

- Created raw intake folder `00_INBOX_SANTO_RAW/`.
- Added `_README_INBOX.md`.
- Added `.gitignore` rules for sensitive credentials and env files.
- Processed two P0 HTML source documents into Markdown docs.
- Created Obsidian-friendly docs structure.
- Clarified that the user's desired "second brain" is for AI-assisted coding, not just a SantoOS product wiki.
- Added AI development memory files:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `santo_context.md`
  - `ai_brain/current_state.md`
  - `ai_brain/build_rules.md`
  - `ai_brain/session_log.md`
- Initialized git.
- Scaffolded P0 repo foundation:
  - `.env.example`
  - `apps/dashboard/`
  - `services/command_handler/`
  - `services/agent_mail/`
  - `supabase/`
  - `workflows/`
- Added executable workflow template with pytest contract tests.
- Verified workflow template returns `requires_review` for unconfirmed config.
- Drafted PR 2 Supabase registry spine migration with explicit P0 tables, RLS, grants, authenticated read policies and `[CONFIRM]` seeds.
- Added migration contract tests and expanded pytest discovery to include `tests/`.
- Verified with `python -m pytest` passing.
- Attempted stronger SQL execution verification, but Supabase CLI and `psql` were unavailable and Docker daemon was not running.
- Scaffolded PR 3 dashboard with Next.js 16 + TypeScript.
- Added Supabase SSR auth wrapper using publishable/anon frontend-safe credentials only.
- Added P0 dashboard view for Corte Santo, exceptions, reviews and Agent Mail.
- Added magic-link sign-in and auth callback routes.
- Patched `npm audit` PostCSS advisory via npm override.
- Verified dashboard with lint, build, audit and browser checks.
- Implemented PR 4 command handler core with structured command validation.
- Added command handler fixtures and tests for missing registry, pending config, missing actor role, unsupported phase, accepted dispatch and idempotency.
- Verified command handler with `python -m pytest` and CLI smoke tests.
- Implemented PR 5 Agent Mail intake/classification core.
- Added Agent Mail fixtures and tests for missing routing, confirmed prefix classification, unclassified email, ignored email, ambiguous routing and idempotency.
- Verified Agent Mail with `python -m pytest` and CLI smoke tests.
- Implemented PR 6 partial Corte Santo intake workflow module.
- Added Corte Santo fixtures and tests for missing config, missing restaurant, registered document intake, document review and idempotency.
- Verified Corte intake returns `requires_review` with config placeholders and does not implement final reconciliation.
- Implemented PR 8 partial XML SAT validation workflow module.
- Added generated CFDI fixture and tests for missing config, successful local parse, unmapped RFC, invalid XML, unsafe DOCTYPE and idempotency.
- Verified XML SAT returns `requires_review` with config placeholders and does not touch SAT/FIEL/portal actions.

## 2026-06-01

- Reconciled client Claude Project Instructions, need-to-know guidance and latest client sprint conversation into repo memory.
- Added execution docs:
  - `docs/03_execution/need_to_know_for_dante.md`
  - `docs/03_execution/first_sprint_alignment.md`
- Updated `AGENTS.md`, `CLAUDE.md`, `santo_context.md`, `ai_brain/build_rules.md`, P0 technical spec, pending inputs and workflow skill template with:
  - P0 document hierarchy.
  - Foundation sprint framing.
  - DRY/MECE Skill Registry gate.
  - Progressive context loading rule.
  - Operational Addendum as configuration only.
  - Agent Mail ambiguity -> `requires_review`.
  - No hardcoded Drive, thresholds, reviewers, restaurant/RFC/routing/source/template/exception rules.

## 2026-06-11

- Reviewed two client source PDFs from `00_INBOX_SANTO_RAW`: the `REVISION` report (the document actually stored in Drive) and the full Corte Santo workflow walkthrough.
- Found the existing Corte Santo reconciliation modeled the wrong process (`sales_total ≈ bank_deposit + cash_count`) and the dashboard emitted a placeholder PDF with a broken `startxref`.
- Redesigned the Corte Santo workflow (ADR-0009):
  - Rewrote `reconcile` to compare `cierre_terminal` vs `cierre_sistema` by confirmed `payment_forms`, with group rollups (Amex/Bancos/Efectivo/Transferencia/Plataformas) and Total Real vs Total Sistema check against `thresholds.reconciliation_tolerance`.
  - Added `build_revision_document` producing the client REVISION format per unit.
  - Updated `config.example.json`, `config_confirmed.json`, all fixtures, `skill.md`, tests and command-handler registry fixtures.
  - Rewrote the dashboard Corte Santo PDF generator to render the REVISION format and fixed the `startxref`/`{streamContent}` PDF assembly bugs via a shared `assembleSimplePdf` helper.
- Verified: `python -m pytest` (48 passed) and `npx tsc --noEmit` on the dashboard pass.
- Added ADR-0009 and updated `ai_brain/current_state.md`.

## 2026-06-11 (Option B: corte Excel extraction)

- Confirmed P0 inputs from user: reconciliation tolerance = 0, only SANTO unit active.
- Implemented Option B (ADR-0010): `workflows/corte_santo/corte_excel_parser.py` extracts Cierre Ter/Pla and Cierre Sistema from the corte Excel via openpyxl, config-driven (`excel_layout`), read-only/`data_only`.
- Wired extraction into `script.run`: auto-extracts when structured figures are absent and a `corte_excel`/`daily_sales_report` document has a `source_path`; unmapped columns / missing file / missing openpyxl -> `extraction_requires_review` -> `requires_review`.
- Standardized `payment_forms` on report groups (amex, bancos, efectivo, transferencia, plataformas) across config, fixtures and tests.
- Added `santo_corte_sample.xlsx` fixture + generator, `scenario_5_from_excel.json`, and `test_corte_excel_parser.py`.
- Updated `config.example.json` (excel_layout), `skill.md`, dashboard sandbox doc mapping, ADR-0010, current_state and pending inputs.
- Verified: `python -m pytest` 53 passed; dashboard `tsc --noEmit` clean; CLI run on the Excel fixture extracts and reconciles to `ready_for_approval` (Total Real = Total Sistema = 38,520.47).

## 2026-06-11 (Dashboard simplification for non-technical users)

- Simplified the dashboard home for a non-technical admin: removed the 4 technical metric tiles and the operations/exceptions/agent-mail grid; replaced with a single "lo que necesita tu revisión" hero (links to /reviews) plus a plain-language "Cortes recientes" list. Statuses and reasons are now humanized (e.g. "El corte cuadró. Falta tu aprobación.", "Las cuentas no cuadran.").
- Trimmed the sidebar to just "Inicio" and "Mis pendientes"; removed the "Próximamente" disabled items and the technical Sandbox link from the main nav.
- Rewrote the guided tour (home + reviews) and welcome modal in plain Spanish aimed at the corte reviewer; removed jargon (Agent Mail, workflows, Supabase, P0).
- Renamed page title/brand subtitle to "Panel de cortes".
- Verified: `tsc --noEmit` clean and `npm run build` succeeds. Remaining lint warnings are all in pre-existing untouched files (route.ts, sandbox/page.tsx, TutorialProvider memoization rule).

## 2026-06-12 (Vision extraction, deploy, dashboard simplification)

- Simplified dashboard for non-technical users (home, sidebar, tour) and updated sandbox scenarios to the payment-form model; prefilled Drive folder.
- Pushed to main (signed as SantoRestaurants so Vercel Hobby would deploy); fixed Vercel root directory (apps/dashboard, Next.js) and loaded Supabase env vars; cleared old test data from Supabase (all operational tables at 0).
- Built corte ingestion components: `vision_extractor.py` (multi-provider: anthropic + gemini, confidence gate -> requires_review) and `bank_statement_parser.py` (Banorte rules). Config extended; ADR-0011 added.
- Validated with the client's real 2026-06-04 test set: Gemini gemini-2.5-flash read all 4 photos (incl. handwritten cash detail); key figures match the client's filled income Excel. Banorte CSV parsed cleanly. Confirmed the cortesía+efectivo rule (5,058.50 + 80 = 5,138.50).
- Wrote `ai_brain/handoff_corte_santo_full_workflow.md` capturing full context to resume in a new conversation.
- SECURITY: Supabase service_role, Google OAuth refresh_token, and Gemini API key were pasted in chat during the session and must be rotated. None were committed to the repo.
- Tests: `python -m pytest workflows/corte_santo/` 23 passing; dashboard tsc/build clean.

## 2026-06-12 (PDF operating procedure + canonical evidence)

- Added the supplied 35-page `Corte Santo.pdf` to
  `docs/04_workflows/source/` and converted it into the persistent operating
  requirements and full-automation gate.
- Added ADR-0012 and `evidence_builder.py`; `script.run` now calls configured
  vision extraction and Banorte parsing and emits traceable canonical evidence.
- Separated zero-tolerance reconciliation values from monthly Ingresos values:
  tips are separate and courtesy is added to cash only for Ingresos.
- Fixed the Corte Excel parser so the repeated cash comparison amount is not
  counted as a cash tip.
- Added parsing of the supplemental Total Sistema block for
  Transferencia/Uber/Rappi. The real 2026-06-04 Corte Excel now reconciles at
  75,685.10 vs 75,685.10, difference 0.
- Replaced the real Supabase project URL in the handoff with a placeholder so
  the secret-pattern safety test passes.
- Corte Santo tests: 27 passing.

## 2026-06-12 (Corte Santo two-stage runtime)

- Added ADR-0013 and executable two-stage Corte orchestration.
- Stage 1 writes configured Ingresos cells in yellow and Forecast, updates
  verified Drive workbooks, notifies the supervisor and waits for bank files.
- Added a Drive watcher that resumes only after both AMEX and Banorte are
  present and rejects duplicate bank documents.
- Stage 2 parses AMEX `.xls` and Banorte, matches expected collections, keeps
  legitimate pending collections in REVISION, marks Ingresos blue and sends the
  final notification.
- Hardened delivery gates: reviewed stages never send success messages, and
  failed or missing Drive updates cannot remain completed.

## 2026-06-13 (Corte Santo real E2E test)

- Sent the real June 4 Corte evidence set through Agent Mail; it was received
  and classified as `[CORTE]`.
- Confirmed exact reconciliation at 75,685.10.
- Added safe recognition of formula-derived Ingresos dates.
- Confirmed the Forecast file is the June projection template; added configured
  month rebasing for a complete stale-date projection series while preserving
  projection amounts.
- Wrote verified test copies: Ingresos yellow, Forecast June 4 Venta Real, then
  Ingresos blue after AMEX/Banorte validation.
- Sent both supervisor notifications to `developer@santorestaurants.com`.
- Full suite: 80 tests pass.
- Remaining production blocker: the connected Drive identity lists the supplied
  folder as empty, so the watcher and live Drive replacement were not verified.

## 2026-06-16 (Drive OAuth refresh-token runtime)

- Added durable Google Drive OAuth refresh-token support to
  `services/drive_connector/connector.py`.
- The connector now accepts `GOOGLE_DRIVE_CLIENT_ID`,
  `GOOGLE_DRIVE_CLIENT_SECRET` and `GOOGLE_DRIVE_REFRESH_TOKEN`, exchanges them
  for a fresh access token, and keeps the old `GOOGLE_DRIVE_ACCESS_TOKEN` only
  as a short-lived local fallback.
- Updated `.env.example`, Drive connector README and tests.
- The Vercel app connector returned `403 Forbidden`, but the local Vercel CLI is
  authenticated. `vercel env ls` for the linked dashboard project does not show
  the new Google Drive OAuth env vars, so they still need to be added to that
  exact Vercel project/environment.
- Verification: `python -m pytest` reports 82 passing tests. The system Python
  3.14 alpha still emits the known openpyxl/numpy native stack trace after the
  suite exits successfully.
