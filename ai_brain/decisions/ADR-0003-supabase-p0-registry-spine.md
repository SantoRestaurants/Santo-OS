# ADR-0003: Supabase P0 Registry Spine

Date: 2026-05-27

## Status

Accepted.

## Context

P0 requires Supabase/Postgres as the source of truth for workflows, runs, documents, tasks, exceptions, approvals/reviews, watchdog, events and Agent Mail. Operational inputs such as thresholds, reviewers, Drive paths, restaurant codes and RFCs are still pending.

Recent Supabase guidance requires explicit grants for Data API exposure and RLS on exposed `public` tables. The project does not yet have a local Supabase CLI, local `psql`, or a running Docker daemon for execution validation.

## Decision

Create a P0 registry spine migration with:

- Explicit P0 tables in `public`.
- RLS enabled on all tables.
- No anonymous table access.
- Authenticated read policies using `auth.uid() is not null`.
- Service-role grants for server-side workflow writes.
- Placeholder seed records marked `[CONFIRM]`.
- Idempotency and deduplication constraints for workflow runs, email messages and documents.

Until the staff access model is confirmed, authenticated users can read P0 operational tables but writes should happen through server-side services using service-role credentials outside frontend code.

## Consequences

- Dashboard work can begin against stable table names.
- Workflow and Agent Mail code have durable registry targets.
- Missing operational inputs remain visible as `requires_review`.
- A future migration may tighten RLS once Santo confirms role structure and staff access boundaries.
- SQL still needs execution validation against Supabase/local Postgres before production use.
