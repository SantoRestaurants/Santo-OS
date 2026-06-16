# ADR-0014: Vercel Cron as Corte Santo Scheduler Trigger

Date: 2026-06-16

## Status

Accepted for P0 testing.

## Context

Corte Santo needs to run without a human opening Codex:

- Poll Agent Mail for daily Corte emails and attachments.
- Watch the confirmed Drive folder for AMEX and Banorte uploads.
- Keep Supabase/Postgres as the source of truth.
- Avoid one-off scripts that bypass the workflow registry and audit model.

The existing dashboard is deployed on Vercel, while the current workflow
runtime is Python.

## Decision

Add a protected Vercel Cron HTTP entrypoint at `/api/cron/santo`.

The endpoint:

- Requires `Authorization: Bearer ${CRON_SECRET}`.
- Invokes `services.scheduler.corte_santo_cron` once per request.
- Supports `job=agent-mail`, `job=bank-watcher` and `job=all`.
- Defaults to `agent-mail` for the scheduled production tick.
- Defaults to dry-run unless `SANTO_CRON_WRITE=true`.
- Returns `requires_review` when credentials, folder/date config or persisted
  resume state are missing.

Vercel is only the scheduler trigger. Workflow state, review state and audit
state remain in Supabase/Postgres.

## Consequences

- Production testing can start from Vercel Cron/manual HTTP calls.
- The first-stage Agent Mail path can run live once env vars are configured.
- The bank watcher can detect the AMEX/Banorte pair from Drive.
- Completing the bank stage still requires persisting the stage-1 expected
  collections/resume payload in Supabase so the scheduled process can safely
  resume the original workflow run.
