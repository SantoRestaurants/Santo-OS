# Workflow Template Skill

This is the base template for SantoOS workflow modules.

Use it to scaffold workflow-specific modules that connect to the P0 registry spine.

## Contract

- Accept structured input.
- Support `dry_run`.
- Produce deterministic idempotency keys for the same logical input.
- Return `requires_review` when config is missing.
- Log start/end/failure.
- Never perform high-risk external actions autonomously.
