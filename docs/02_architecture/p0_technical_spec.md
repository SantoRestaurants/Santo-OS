# Santo AI OS P0 Technical Spec v2

Source: `00_INBOX_SANTO_RAW/santo_ai_os_p0_especificacion_tecnica_v2_es_final.html`

Generated source date: 2026-05-25.

## Critical Build Rule

Dante can start PR 1 through PR 5 immediately.

Do not hardcode:

- Drive paths.
- Thresholds.
- Reviewers.
- Restaurant codes.
- Email routing.
- `source_hash`.
- Template columns.
- Exception rules.
- Business assumptions.

Everything must be configurable and confirmed by Santo.

## Document Hierarchy

For P0:

1. PRD v2 is the product source of truth.
2. Technical Build Spec v2 is the technical source of truth.
3. Claude Project Instructions are the long-term constitution.
4. The Operational Addendum is confirmed configuration, not a new PRD or architecture.

If the long-term Claude instructions and the P0 PRD/spec disagree about P0 scope, the P0 PRD/spec win.

## Architecture

```text
Agent Mail / Dashboard / Scheduler / future WhatsApp
  -> Shared Command Handler
  -> Permission Check
  -> Workflow Module
  -> Supabase/Postgres
  -> Notification
  -> Events + Watchdog
```

| Layer | P0 Implementation |
|---|---|
| Source of truth | Supabase/Postgres |
| Dashboard | Next.js with role-based views |
| Intake/notification | Agent Mail / OS inbox |
| Execution | Python modules with `skill.md` and `script.py` |
| AI | Claude for ambiguity, classification and summaries; never approval truth |
| Scheduler | Decide before daily jobs: GitHub Actions or Railway |
| Connectors | Gmail, Drive, Sheets, Composio, WhatsApp transports; never source of truth |

## Skill Registry DRY/MECE Rule

Before creating a new skill/module/script:

1. Check the Workflow Registry and existing workflow folders.
2. Confirm no existing skill already covers the function.
3. Confirm no existing skill can be parameterized or extended.
4. Confirm the new skill does not overlap another skill's purpose, inputs or outputs.

If overlap exists, extend the existing skill.

Every new skill must be registered in the Workflow Registry before first commit.

## Execution Classification

Every workflow must declare:

- `execution_environment`: local, remote or hybrid.
- `requires_local_machine`.
- `requires_human_review`.
- `requires_sensitive_credentials`.
- `allowed_trigger_channels`.

Local workflows require a trusted machine. Remote workflows can run headless. Hybrid workflows use cloud tracking with local execution where needed.

## PR Sequence

| PR | Scope | Can Start? | Depends on Team? |
|---|---|---|---|
| PR 1 | Repo, templates, `santo_context.md`, `skill_template.md`, env examples | Yes | No |
| PR 2 | Supabase schema, explicit workflow_runs/email_messages, RLS, seed placeholders | Yes | No, with clear placeholders |
| PR 3 | Dashboard shell + auth + roles | Yes | No |
| PR 4 | Shared command handler + events/watchdog | Yes | No |
| PR 5 | Agent Mail polling/intake: email_messages + metadata + safe classification | Yes | Routing convention can remain pending |
| PR 6 | Corte intake creates workflow_run/documents/tasks; no final reconciliation | Partial | Attachments/folder map pending |
| PR 7 | Corte checks + exceptions | No | Thresholds, severities and reviewers required |
| PR 8 | Thin XML SAT validation | Partial | RFCs/folders pending |
| PR 9 | Thin Utilities validation | No | Template/folders/Sheets scope pending |
| PR 10 | Hardening, tests, deploy checklist, handoff | Later | Depends on prior PRs |

## Default Behavior When Rules Are Missing

- Unconfirmed thresholds create medium exceptions and leave the workflow run as `requires_review`.
- Unknown folders must not be written to; create a placeholder and exception.
- Unknown reviewer uses default owner if available, otherwise `requires_review`.
- Unclassified email becomes `email_messages.processing_status = requires_review`; do not guess.
- No pending threshold can pass as `completed`.

## Agent Mail Routing

Final convention is pending and must be configurable.

Preferred P0 options:

- Subject prefixes like `[CORTE]`, `[XML]`, `[UTILIDADES]`.
- Gmail labels.
- Sender-based rules only as supporting signals.
- Attachment type only as supporting signal.

`ignored` is only allowed when a confirmed rule says the email is definitely not workflow-related. Ambiguous email must be `requires_review`.

Agent Mail in P0 must create `email_messages`, link classified emails to `workflow_runs`, save attachment metadata as `documents`, send summaries/alerts/review requests and log activity in `events`.

Agent Mail must not read unrelated mail, become the source of truth, approve sensitive actions or silently ignore ambiguous mail.

## Acceptance Before Merge

- No secrets in repo.
- RLS active.
- Service role never exposed to frontend.
- `workflow_runs` and `email_messages` explicit.
- Every module has `skill.md`, `config.example.json` and model dependency docs.
- Every script supports `dry_run` and idempotency.
- Pending rules default to `requires_review`.
- Agent Mail does not guess routing.
- Dashboard shows runs and exceptions.
- Tests cover duplicates/idempotency and missing config.

## Current Foundation Sprint

The current sprint should not be called complete P0.

Done for the foundation sprint means:

- PR 1 through PR 4 complete and tested.
- PR 5 Agent Mail core works for intake, logging and safe classification.
- PR 6 intake only creates workflow_runs, documents, tasks, exceptions, events and `requires_review`.
- The base flow is visible with fixtures/synthetic data: input -> workflow_run -> documents/tasks/exceptions -> events/watchdog -> dashboard.
- RLS/security, idempotency, events/watchdog and `requires_review` are demonstrated from the start.
- Pending operational rules are listed clearly.

## Not P0 Unless Reintroduced

Employee Document Intake is not active P0 scope. It remains future/P3+ unless Santo explicitly reintroduces it.

## Operational Addendum

The pending Operational Addendum should convert confirmed team answers into technical configuration:

- `drive_folder_map`
- `corte_thresholds`
- `reviewer_map`
- `restaurant_entity_rfc_map`
- `agent_mail_routing_rules`
- `utility_receipt_config`
- `xml_sat_config`
