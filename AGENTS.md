# SantoOS Agent Instructions

This file is the development second brain for Codex and other coding agents working on SantoOS.

Before coding, read these files in order:

1. `santo_context.md`
2. `ai_brain/current_state.md`
3. `ai_brain/build_rules.md`
4. `docs/01_product/p0_prd.md`
5. `docs/02_architecture/p0_technical_spec.md`
6. `docs/99_pending_inputs/p0_operational_inputs_pending.md`
7. `docs/03_execution/need_to_know_for_dante.md`
8. `docs/03_execution/first_sprint_alignment.md`

## Document Hierarchy

- Claude Project Instructions define the long-term constitution: vision, architecture, safety and roadmap.
- `docs/01_product/p0_prd.md` is the product source of truth for P0.
- `docs/02_architecture/p0_technical_spec.md` is the technical source of truth for P0.
- `docs/99_pending_inputs/p0_operational_inputs_pending.md` tracks the Operational Addendum inputs.

If long-term Claude instructions conflict with the P0 PRD or technical spec, the P0 PRD and technical spec win for P0.

## Mission

Build Santo AI OS as a long-term, AI-native operational system for Santo.

P0 must prove the operating model through the smallest reliable foundation slice:

- One domain: Admin / HR / Payroll / Accounting / Fiscal.
- One primary workflow: Corte Santo - Daily Sales Reconciliation.
- One restaurant/unit first.
- One dashboard path.
- One Agent Mail notification/intake path.
- One approval/review model.
- One Supabase/Postgres registry spine.

## Non-Negotiables

- Supabase/Postgres is the source of truth.
- Third-party tools are connectors, not the brain, approval model, audit trail or security model.
- Do not build random one-off scripts.
- Every workflow must connect to workflow registry, runs, tasks, documents, exceptions, approvals/reviews, watchdog and events.
- Do not hardcode Drive paths, thresholds, reviewers, restaurant codes, RFCs, email routing, `source_hash` rules, template columns, exception rules or business assumptions.
- If config is missing, return `requires_review`; do not silently complete.
- Uncertainty must never become `completed`.
- AI can classify, draft, summarize, validate and recommend.
- AI must not autonomously execute bank, payroll, SAT, IDSE, IMSS, legal, fiscal or government-portal actions.
- Never commit secrets.

## Build Defaults

- Frontend/dashboard: Next.js + TypeScript.
- Source of truth: Supabase/Postgres.
- Workflow execution: Python modules with `skill.md`, `script.py`, `config.example.json`, fixtures and tests.
- Shared entry point: command handler used by dashboard, Agent Mail, scheduler and future WhatsApp.
- Default phase: P0.
- Current sprint framing: foundation sprint, not full P0 completion.
- Every workflow declares execution type: local, remote or hybrid.
- Keep `santo_context.md` light. Put domain-specific detail in domain/workflow context files and load only what each workflow needs.

## Skill Registry Integrity

Before creating a new skill/module/script, check the Workflow Registry and existing workflow folders.

Confirm:

1. No existing skill already covers the function.
2. No existing skill can be parameterized or extended to cover it.
3. The new skill does not overlap with another skill's purpose, inputs or outputs.

If an existing skill can cover the case, extend that skill instead of creating a new one.

Every new skill must be registered in the Workflow Registry before first commit.

## Agent Workflow

For every implementation task:

1. Check the current state in `ai_brain/current_state.md`.
2. Confirm whether the requested work belongs to P0.
3. Read the relevant docs and pending inputs.
4. Implement the smallest safe slice.
5. Add or update tests when behavior changes.
6. Update `ai_brain/current_state.md` if project state changes.
7. Add a decision note under `ai_brain/decisions/` if an architectural decision is made.
8. If operational rules are missing, add them to the pending Operational Addendum instead of guessing.
