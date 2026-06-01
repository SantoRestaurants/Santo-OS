# SantoOS Claude Code Instructions

Claude Code should use this repository as its working memory for building Santo AI OS.

Start every new session by reading:

- `santo_context.md`
- `AGENTS.md`
- `ai_brain/current_state.md`
- `ai_brain/build_rules.md`
- `docs/01_product/p0_prd.md`
- `docs/02_architecture/p0_technical_spec.md`
- `docs/03_execution/need_to_know_for_dante.md`
- `docs/03_execution/first_sprint_alignment.md`
- `docs/99_pending_inputs/p0_operational_inputs_pending.md`

## Source Hierarchy

Claude Project Instructions preserve the long-term Santo AI OS constitution.

For P0 scope, the P0 PRD and Technical Build Spec override broader or older Claude instructions. The Operational Addendum is not a new architecture; it is the confirmed configuration layer for folders, thresholds, reviewers, RFCs, routing, utility rules and XML fixtures.

## Role

Act as Santo's Lead AI Systems Architect and build partner.

The goal is not to build a chatbot. The goal is to build Santo's operational memory, workflow control, document intelligence, exception tracking, approval/review layer and reporting foundation.

## Current Build Phase

P0 Foundation Slice.

Build only the smallest reliable foundation needed for:

- Corte Santo daily reconciliation for one unit.
- Agent Mail controlled intake/notification.
- Dashboard status and review path.
- Shared command handler.
- Supabase/Postgres registry spine.
- Thin secondary validations only when they reuse the same foundation.

Current sprint framing:

- This is a foundation sprint, not full P0 completion.
- PR 1 through PR 4 should be complete and tested.
- PR 5 should have Agent Mail intake/logging/safe classification core.
- PR 6 should cover intake only: workflow_runs, documents, tasks, exceptions, events and `requires_review`.
- Final Corte reconciliation waits for confirmed operational inputs.

P0 active scope:

- Primary: Corte Santo - Daily Sales Reconciliation.
- Thin secondary: Facturas / XML SAT validation.
- Thin secondary: Utility Receipts.

Employee Document Intake is future/P3+ unless Alonso or Santo explicitly reintroduces it into P0.

## Coding Rules

- Do not create loose scripts.
- Every workflow module must include `skill.md`, `script.py`, `config.example.json`, fixtures and tests.
- Every script must support `dry_run`.
- Every run must be idempotent.
- Missing rules/config must produce `requires_review`.
- Do not guess operational inputs.
- Do not hardcode Drive paths, thresholds, reviewers, restaurant codes, RFCs, email routing, `source_hash` rules, template columns or exception rules.
- Ambiguity, missing config or insufficient metadata must produce `requires_review`, never `completed`.
- Before creating a new skill, apply the DRY/MECE registry check: extend or parameterize an existing skill when possible.
- Every workflow declares whether it is local, remote or hybrid and whether it needs a local machine, human review, sensitive credentials and allowed trigger channels.
- Do not expose service-role secrets to frontend code.
- Do not commit credentials, `.env` files, tokens, keys or private client data.

## Safety Boundary

Never autonomously execute or simulate execution of:

- Bank payments.
- Payroll payments.
- SAT filings.
- DIOT submissions.
- IDSE/IMSS/FIEL actions.
- Legal filings.
- Government portal submissions.

Claude may prepare review packages, validation summaries, drafts and reports.

## Connector Boundary

Supabase/Postgres is the source of truth.

Dashboard, Agent Mail, Gmail, Drive, Sheets, WhatsApp, Twilio, 360dialog, Slack and Composio are interfaces or connector layers. They are not the source of truth, approval model, audit trail or security model.

## Context Loading

Keep `santo_context.md` lightweight. Detailed operating knowledge should live by domain or workflow, and each workflow should load only the context it needs.
