# ADR-0004: Dashboard Auth And Read Model

Date: 2026-05-27

## Status

Accepted.

## Context

PR 3 needs a dashboard shell with auth and roles before the command handler and Agent Mail are fully implemented. Supabase keys are not configured in the repo and operational staff roles are not confirmed yet.

## Decision

Use a Next.js 16 App Router dashboard with Supabase SSR auth:

- Browser/server dashboard clients use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, falling back to legacy anon key only if needed.
- Service-role credentials are not imported by dashboard code.
- Role display comes from Supabase `app_metadata`, not user-editable metadata.
- Missing Supabase config displays a safe config-pending state.
- Dashboard reads P0 operational tables through RLS-protected authenticated queries.
- Dashboard write actions remain disabled until PR 4/command handler is wired.

## Consequences

- The dashboard can be developed and visually verified before live Supabase credentials are configured.
- Auth and role assumptions remain conservative.
- Future write flows have a clear boundary: server-side command handler only.
