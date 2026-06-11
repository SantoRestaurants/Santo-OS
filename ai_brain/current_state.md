# Current State

Last updated: 2026-06-08.

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

Pause for confirmed operational inputs before PR 7 / PR 9 / production hardening.

Recommended smallest safe slice:

1. Rotate the exposed Supabase service-role key.
2. Install/configure Supabase CLI or provide a running local Supabase/Postgres for migration execution validation.
3. Confirm Drive URLs, folder IDs, hierarchy, naming, permissions and the
   Google identity used by SantoOS.
4. Confirm Corte thresholds, severities, mandatory attachments and reviewer map.
5. Confirm restaurant/entity/RFC mappings and short codes.
6. Confirm Agent Mail routing convention.
7. Provide at least one real anonymized/sanitized MiAdminXML export fixture.
8. Confirm Utilities template/folders/Sheets scope before PR 9.
9. Keep new workflow creation behind the Workflow Registry DRY/MECE gate.

## Not Started

- Supabase migration has not been applied to a live/local database yet.
- No production workflow scripts yet.
- No live Agent Mail polling/integration yet.
- Dashboard has live Supabase query wrappers but no deployed Supabase env/session yet.
- No dashboard component tests yet.
- No Corte final reconciliation checks yet.
- Utility receipts thin workflow exists, but final template rules, folder mapping
  and Sheets scope remain pending.
- Drive connector is not activated against Santo's real folders yet because
  folder IDs, permissions and runtime credentials remain pending.

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
  - `python -m pytest` passes.
  - Smoke test with `config.example.json` returns `requires_review`.
  - Dashboard `npm run lint`, `npm run build` and `npm audit --audit-level=moderate` pass.
  - Secret-pattern search found no real Supabase JWT/project URL material outside ignored build/dependency folders.
- XML SAT verification:
  - `python -m pytest` passes.
  - Smoke test with `config.example.json` returns `requires_review`.
  - Confirmed-config tests validate generated CFDI metadata locally.
- Drive connector verification:
  - Confirmed demo config produces a proposed Drive document and audit event
    in `dry_run`.
  - Unconfirmed folders and missing credentials return `requires_review`.
