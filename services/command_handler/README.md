# Shared Command Handler

P0 command-handler core.

All trigger channels should converge here:

- Dashboard manual actions.
- Agent Mail intake.
- Scheduler jobs.
- Future WhatsApp commands.

Responsibilities:

- Normalize structured command input.
- Check permissions.
- Dispatch to workflow modules.
- Record events.
- Update watchdog status.
- Return clear status, including `requires_review` when config is missing.

Current implementation:

- `handler.py` validates structured command envelopes.
- Missing registry/config/actor role returns `requires_review`.
- Idempotency keys are deterministic for the same logical command.
- Events and watchdog rows are returned for persistence by the future Supabase adapter.

The handler does not execute business workflows directly until registry-backed dispatch is wired.
