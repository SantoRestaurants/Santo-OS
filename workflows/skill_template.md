# Workflow Skill Template

Use this template when creating a new SantoOS workflow module.

## Purpose

[CONFIRM] Describe the workflow and the operational problem it solves.

## P0 Scope

[CONFIRM] Define the smallest safe slice. If the workflow is not P0, document it instead of building it.

## Inputs

- Structured command payload.
- Config loaded from Supabase/Postgres or a checked-in `config.example.json`.
- Documents or attachments registered in the document registry.

## Outputs

- `workflow_run` status.
- Documents/tasks/exceptions/approvals as needed.
- Events and watchdog log entries.
- Review package when human approval is required.

## Required Metadata

- Workflow owner: [CONFIRM]
- Operating domain: [CONFIRM]
- Risk level: [CONFIRM]
- Automation type: local, remote or hybrid.
- Execution environment: [CONFIRM]
- Required tools: [CONFIRM]
- Required credentials or secrets: [CONFIRM]
- Sensitive credentials involved: yes/no.
- Trigger channels: dashboard, Agent Mail, scheduler, future WhatsApp or forms.
- Idempotency key: [CONFIRM]
- Manual fallback: [CONFIRM]
- Rollback procedure: [CONFIRM]
- Phase classification: P0, P1, P2, etc.
- Intentionally not building yet: [CONFIRM]

## Registry Integrity

Before creating this skill, confirm:

1. No existing skill already covers this function.
2. No existing skill can be parameterized or extended instead.
3. This skill does not overlap another skill's purpose, inputs or outputs.

Register the skill in the Workflow Registry before first commit.

## Safety

AI may classify, summarize, validate, draft and recommend.

AI must not autonomously execute bank, payroll, SAT, IDSE, IMSS, legal, fiscal or government-portal actions.

Missing config or business rules must return `requires_review`.
