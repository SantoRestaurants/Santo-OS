# ADR-0017: Dashboard Request Authorization and Business Time

Status: accepted

## Decision

Financial read models and state-changing dashboard routes must authenticate the
request with Supabase Auth and enforce an explicit role allowlist. Server-only
service credentials are not an authentication fallback for browser requests.

Operational dates are calculated in `America/Mexico_City`. UTC remains the
storage and transport convention for timestamps, but it does not define a
restaurant business day.

## Consequences

- `/socios` requires a `supervisor` or `socio` identity.
- Corte AI, workflow trigger and sandbox execution require an authenticated
  role; mutation and sandbox routes are supervisor-only.
- Provider fallbacks are limited to configured, approved providers. NVIDIA's
  DeepSeek fallback is removed pending governance approval.
- Schedulers, Agent Mail and Vercel cron share the same business-day rule.
