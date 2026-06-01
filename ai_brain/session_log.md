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
