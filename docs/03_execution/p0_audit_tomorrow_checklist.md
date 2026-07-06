# P0 Audit Checklist for 2026-07-06

## Blocking before operational use

- [ ] Rotate the exposed Supabase `service_role` key. The current local key
  matches the key present in public Git history.
- [ ] Replace the rotated key in local development, Vercel and GitHub Actions.
- [ ] Make `SantoRestaurants/Santo-OS` private. It remained public on
  2026-07-05; the connected GitHub identity could not change visibility.
- [ ] Redeploy and verify `/socios`, Corte AI, workflow trigger and sandbox
  from a signed-out browser.

## Closed in the audit hardening change

- [x] `/socios` requires an authenticated `supervisor` or `socio`.
- [x] Corte AI no longer falls back to a service client for anonymous callers.
- [x] Workflow trigger and sandbox execution require a supervisor.
- [x] Sandbox scenario names are constrained to known-safe characters.
- [x] NVIDIA/DeepSeek was removed from the implicit AI provider cascade.
- [x] Business dates use `America/Mexico_City` across scheduler, Agent Mail and
  Vercel cron.
- [x] Secret scanning and dashboard/Python checks run in CI.

## Functional acceptance tomorrow

- [ ] Sign in as supervisor and verify Dashboard, Cortes, Conciliacion and
  Socios for June and July 2026.
- [ ] Verify role denial with a non-supervisor test user.
- [ ] Process one representative Corte email through intake, review, approval
  and bank reconciliation; confirm one run, documents, review and events.
- [ ] Confirm CxC opening and settlement do not double-count principal and that
  a newly known tip lands on settlement day.
- [ ] Confirm the Mexico business date around midnight UTC/previous local day.
- [ ] Confirm Vercel and GitHub workflows use the newly rotated key.

## Remaining P0 architecture work

- [ ] Route dashboard, Agent Mail and scheduler through the shared command
  handler instead of parallel orchestration paths.
- [ ] Add end-to-end `trace_id` propagation and persisted watchdog state.
- [ ] Move operational configuration and personal identities out of committed
  runtime config into governed Supabase records.
- [ ] Complete the role/RLS matrix and Agent Mail governance controls.
- [ ] Enable branch protection and required CI checks on `main`.
