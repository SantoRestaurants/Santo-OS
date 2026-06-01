# Supabase

Supabase/Postgres is the source of truth for SantoOS.

P0 schema work belongs in ordered migration files under `supabase/migrations/`.

Required registry spine:

- `domains`
- `workflows`
- `workflow_runs`
- `documents`
- `tasks`
- `exceptions`
- `approvals` / `reviews`
- `watchdog_log`
- `events`
- `email_messages`
- supporting registries for people, vendors, restaurants, legal entities/RFCs and Drive folder map

Rules:

- RLS must be active before production use.
- Service-role credentials must never be exposed to dashboard/client code.
- Seed data must use placeholders marked `[CONFIRM]` until Santo confirms operational inputs.
