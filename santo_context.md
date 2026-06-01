# Santo Context

This is the master context file for AI agents building SantoOS.

## Company / Product

Santo AI OS is Santo's internal operating brain.

It connects people, documents, workflows, approvals, exceptions, reports and decisions. It is not a generic chatbot and not a collection of random scripts.

## Current Phase

P0 - Foundation Slice.

## P0 Goal

Prove the operating model with:

- One domain.
- One primary workflow.
- One unit first.
- One dashboard path.
- One notification/intake channel.
- One approval/review model.
- One registry spine.

## P0 Domain

Admin / HR / Payroll / Accounting / Fiscal.

## P0 Primary Workflow

Corte Santo - Daily Sales Reconciliation.

Purpose:

- Daily recurring operation.
- Restaurant/unit-level data.
- Reconciliation logic.
- Exception detection.
- Dashboard visibility.
- Summary generation.
- Workflow run tracking.
- Watchdog and failure alerts.
- Human review flow.

## P0 Secondary Thin Workflows

- XML SAT validation.
- Utility receipts matching.

These must stay thin and reuse the same foundation.

## Source Of Truth

Supabase/Postgres is the source of truth for:

- Operating domains.
- Workflows.
- Workflow runs.
- Documents.
- People.
- Vendors.
- Restaurants.
- Legal entities/RFCs.
- Tasks.
- Exceptions.
- Approvals/reviews.
- Watchdog logs.
- Events.
- Email messages.
- Drive folder map.

Third-party tools are connectors, not the brain.

Connector boundary:

- Agent Mail, Gmail, Drive, Sheets, WhatsApp, Twilio, 360dialog, Slack and Composio may move messages or files.
- They must not become the source of truth, approval model, audit trail or security model.
- Important workflow state belongs in Supabase/Postgres.

## Core Interfaces

- Dashboard: primary staff interface.
- Agent Mail: controlled intake and notification channel.
- Scheduler: future recurring jobs.
- WhatsApp: future operational command channel.
- Shared command handler: one backend path for all trigger channels.

## Human Approval Boundary

AI can prepare, classify, validate, summarize and draft.

AI must not autonomously execute high-risk actions.

## Current Sprint Framing

The current development target is a foundation sprint, not full P0 completion.

Success means proving the base flow with fixtures/synthetic data:

input -> workflow_run -> documents/tasks/exceptions -> events/watchdog -> dashboard.

Final Corte reconciliation and operational business rules wait for confirmed Santo inputs.

## Context Loading Rule

Keep this file lightweight.

Detailed operating context should live in domain or workflow context files and be loaded only when needed. Corte Santo should not load HR context, and XML SAT should not load unrelated restaurant-ops context.
