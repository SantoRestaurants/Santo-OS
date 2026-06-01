# ADR-0005: Shared Command Handler Core

Date: 2026-05-27

## Status

Accepted.

## Context

P0 requires dashboard, Agent Mail, scheduler and future WhatsApp to use one shared command path instead of one-off scripts. The Supabase registry spine exists as a migration draft, but no live Supabase adapter is configured yet.

## Decision

Implement a Python command handler core under `services/command_handler/` that:

- Accepts structured command envelopes.
- Enforces P0 phase discipline.
- Validates source channel, command type, actor role and workflow registry presence.
- Returns `requires_review` when registry/config/actor role is missing or unconfirmed.
- Computes deterministic idempotency keys.
- Returns event and watchdog records for future Supabase persistence.
- Accepts registry-backed commands for dispatch only when workflow config is confirmed.

The handler currently prepares commands and persistence records. It does not directly execute business workflow modules until the Supabase registry adapter and workflow dispatch map are built.

## Consequences

- Dashboard and Agent Mail can share the same command contract.
- Missing operational inputs remain explicit and auditable.
- Future adapters can persist returned `events` and `watchdog_log` rows without changing validation behavior.
