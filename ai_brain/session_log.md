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
