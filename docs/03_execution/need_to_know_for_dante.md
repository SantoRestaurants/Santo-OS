# Santo AI OS Need-To-Know For Dante

This note summarizes the latest build guidance from the client instructions and the short "need-to-know" source document.

## Core Idea

Santo AI OS must not become a pile of useful but disconnected scripts.

Every workflow must connect to the shared OS spine:

- workflows
- workflow_runs
- documents
- tasks
- exceptions
- approvals/reviews
- events
- watchdog_log
- drive_folder_map
- email_messages when Agent Mail is involved

If an automation works but does not strengthen the shared Santo AI OS memory, it is not built correctly for this project.

## Document Hierarchy

- Claude Project Instructions: long-term constitution, architecture, safety and roadmap.
- PRD v2: P0 product source of truth.
- Technical Build Spec v2: P0 technical source of truth.
- Operational Addendum: confirmed configuration from Santo.

Conflict rule: if Claude Project Instructions and the P0 PRD/spec disagree about P0, the P0 PRD/spec win for P0.

## Active P0 Scope

P0 proves the operating model.

- Primary: Corte Santo - Daily Sales Reconciliation.
- Thin secondary: Facturas / XML SAT validation.
- Thin secondary: Utility Receipts.

Employee Document Intake is not active P0. It is future/P3+ unless Alonso or Santo explicitly reintroduces it.

## DRY/MECE Skill Registry Rule

Before creating a new skill, module or script, check whether an existing workflow already covers the function or can be parameterized.

Confirm:

1. No existing skill already covers the function.
2. No existing skill can be extended or parameterized.
3. The new skill does not overlap with another skill's stated purpose, inputs or outputs.

If an existing skill can cover the case, extend that skill.

Every new skill must be registered in the Workflow Registry before first commit.

## Progressive Context Loading

Keep `santo_context.md` light.

It should contain company overview, operating domains, current phase, active workflow and general rules. Detailed context should live by domain or workflow, and each workflow should load only what it needs.

## Agent Mail In P0

Agent Mail is part of P0 as the controlled intake and notification channel for the OS identity, for example `os@santo.com`.

Agent Mail should:

- receive workflow emails and attachments
- create `email_messages`
- link classified emails to `workflow_runs`
- save attachment metadata as `documents`
- send summaries, alerts and review requests
- log activity in `events`

Agent Mail must not:

- be the source of truth
- approve sensitive actions
- read unrelated mail
- silently ignore ambiguous mail

Ambiguous mail must become `requires_review`, not `ignored`.

## Can Build Now

Dante/Codex can advance the P0 foundation without waiting for operational answers:

- PR 1: repo, templates, `santo_context.md`, `skill_template.md`, env examples
- PR 2: Supabase schema, RLS, seed placeholders, `workflow_runs`, `email_messages`
- PR 3: dashboard shell, auth and roles
- PR 4: shared command handler, events and watchdog
- PR 5: Agent Mail intake and metadata logging

Foundation work can move fast. Business logic that depends on Santo-confirmed rules must wait or return `requires_review`.

## Do Not Finalize Yet

Do not finalize:

- Corte final reconciliation logic
- AMEX, Banorte, cash, tips, Uber, Rappi or other thresholds
- definitive Drive routes
- reviewers by exception type
- restaurant/entity/RFC maps
- definitive Agent Mail routing
- Utility template rules or Sheets writeback
- final XML SAT parser behavior without real sanitized fixtures

If confirmation is missing, mark `requires_review`.

## Operational Addendum

The Operational Addendum is not another PRD and not another architecture. It turns Santo's confirmed answers into configuration:

- `drive_folder_map`
- `corte_thresholds`
- `reviewer_map`
- `restaurant_entity_rfc_map`
- `agent_mail_routing_rules`
- `utility_receipt_config`
- `xml_sat_config`

The build should not work because we guessed Santo's rules. It should work because Santo confirmed them.

