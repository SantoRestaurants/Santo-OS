# ADR-0002: P0 Repo Foundation Structure

Date: 2026-05-27

## Status

Accepted.

## Context

SantoOS P0 needs one dashboard path, one Agent Mail path, one shared command handler, one Supabase/Postgres registry spine and Python workflow modules. The repo had documentation and AI memory, but no build structure.

## Decision

Use a small foundation structure that matches the P0 technical spec:

- `apps/dashboard/` for the future Next.js + TypeScript dashboard.
- `services/command_handler/` for the shared command path.
- `services/agent_mail/` for inbox intake and notification integration.
- `supabase/` for migrations and database notes.
- `workflows/` for Python workflow modules and templates.

The first executable workflow code is a `_template` module, not a Santo-specific business workflow. It proves the required contract: structured input, `dry_run`, idempotency key, logging, clear output and `requires_review` for missing config.

## Consequences

- Future PRs have clear homes without inventing one-off script locations.
- PR 2 can replace the Supabase placeholder with the real registry spine.
- PR 4 can build the command handler without changing workflow module shape.
- PR 6 can scaffold Corte Santo from the template once operational inputs are confirmed enough for partial intake.
