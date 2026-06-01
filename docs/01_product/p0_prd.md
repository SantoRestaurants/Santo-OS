# Santo AI OS P0 PRD v2

Source: `00_INBOX_SANTO_RAW/santo_ai_os_p0_prd_v2_es_final (1).html`

Generated source date: 2026-05-25.

## Executive Summary

Santo AI OS P0 v2 is the first buildable version of Santo's operational intelligence layer. It proves the OS model with one primary workflow, Corte Santo, and two thin secondary validations: XML SAT validation and utility receipts.

There should be no separate technical addendum for now. The only future addendum should contain operational answers confirmed by Manuela, Abraham and the admin team.

## Operating Principle

P0 proves the operating model, not the entire vision:

- One domain.
- One primary workflow.
- One unit first.
- One dashboard.
- Agent Mail as controlled intake and notification channel.
- One review/approval model.
- One registry spine.

## P0 Workflow Priorities

| Priority | Workflow | Role in P0 | Depth |
|---|---|---|---|
| Primary | Corte Santo - Daily Sales Reconciliation | End-to-end proof of daily workflow, reconciliation, exceptions, dashboard, Agent Mail and audit. | One restaurant/unit first; scoped but real. |
| Secondary | Facturas / XML SAT Validation | Proves fiscal can connect to the same foundation. | Thin validation: XMLs/exports. No SAT/FIEL automation. |
| Secondary | Utility Receipts | Proves document matching, Drive and tracking. | Thin validation: match receipt, file, register status and exceptions. |

## Product Requirements

| ID | Requirement | Priority |
|---|---|---|
| PRD-001 | Supabase/Postgres registry spine: domains, workflows, workflow_runs, documents, tasks, exceptions, approvals/reviews, watchdog, events, email_messages. | Must |
| PRD-002 | Agent Mail: an email to the OS inbox is parsed, creates email_messages and links to workflow_run when classified. | Must |
| PRD-003 | Dashboard: status, Corte, exceptions, review queue, Agent Mail activity and manual buttons. | Must |
| PRD-004 | Corte Santo for one restaurant/unit with safe thresholds while values are confirmed. | Must |
| PRD-005 | SAT/XML as thin validation; full build later. | Should |
| PRD-006 | Utilities as thin validation; writeback to Sheets deferred unless confirmed. | Should |
| PRD-007 | WhatsApp stub through command handler; production later. | Could |

## P0 Non-Goals

- No production WhatsApp.
- No full financial reporting engine.
- No SAT/FIEL/IDSE/bank/payroll automation.
- No autonomous high-risk approvals.
- No hardcoded Drive paths, thresholds, reviewers, email routing or restaurant/entity assumptions.
- No full Drive reorganization.
- No Sheets writeback for Utilities unless explicitly confirmed.

## Success Criteria

- An email to the OS inbox creates `email_messages` and links to `workflow_run` when classified.
- Corte Santo creates a `workflow_run` for one restaurant/date.
- Documents/evidence link to workflow runs and tasks.
- Missing inputs or unconfirmed thresholds become `requires_review`.
- Dashboard shows Corte, runs, exceptions and reviews.
- Agent Mail sends summary or alert.
- Every action generates audit events.
- Re-running the same input does not duplicate or corrupt data.
- Secondary workflows reuse the same foundation.
