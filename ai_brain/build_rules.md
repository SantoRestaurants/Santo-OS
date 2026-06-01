# Build Rules

These rules exist so AI coding sessions stay coherent across a long project.

## Phase Discipline

Default to P0 unless the user explicitly changes phase.

If a feature belongs to the long-term vision but not P0, document it instead of building it.

The current sprint is a foundation sprint, not full P0 completion.

## Document Hierarchy

For P0 scope, follow this hierarchy:

1. `docs/01_product/p0_prd.md`
2. `docs/02_architecture/p0_technical_spec.md`
3. `docs/03_execution/need_to_know_for_dante.md`
4. Claude Project Instructions for long-term architecture and roadmap

The Operational Addendum is configuration, not architecture.

## Configuration Discipline

Do not hardcode:

- Drive paths.
- Restaurant codes.
- RFC mappings.
- Thresholds.
- Reviewers.
- Email routing rules.
- `source_hash` rules.
- Template columns.
- Exception rules.
- Scheduler choice.
- Sensitive credential assumptions.

Use config files, database records or placeholders marked `[CONFIRM]`.

Uncertainty must become `requires_review`, never `completed`.

## Skill Registry DRY/MECE Gate

Before creating a new workflow skill, check the Workflow Registry and existing workflow folders.

Confirm:

1. No existing skill already covers the function.
2. No existing skill can be parameterized or extended to cover the case.
3. The proposed skill does not overlap with another skill's purpose, inputs or outputs.

Default to extending the existing skill when there is overlap.

Every new skill must be registered in the Workflow Registry before first commit.

## Workflow Module Contract

Every workflow module must include:

- `skill.md`
- `script.py`
- `config.example.json`
- `fixtures/`
- `tests/`

Every workflow module must declare:

- `execution_environment`
- `requires_local_machine`
- `requires_human_review`
- `requires_sensitive_credentials`
- `allowed_trigger_channels`

Every `script.py` must:

- Accept structured input.
- Support `dry_run`.
- Be idempotent.
- Log start/end/failure.
- Return clear output.
- Use `requires_review` when config or business rules are missing.

## Data Contract

Important state belongs in Supabase/Postgres.

Workflow modules must connect back to:

- workflows
- workflow_runs
- documents
- tasks
- exceptions
- approvals/reviews
- watchdog_log
- events
- email_messages when Agent Mail is involved
- drive_folder_map when Drive locations are involved

## Trigger Contract

Dashboard, Agent Mail, scheduler, future WhatsApp and future forms must pass through the shared command handler.

Do not build separate automation systems per channel.

## Safety Contract

No autonomous high-risk execution.

If a workflow touches fiscal, legal, payroll, bank, government or sensitive employee data, it must produce review packages and logs, not final external actions.

Third-party tools are connector layers only. They are not the approval truth, audit trail, source of truth or security model.
