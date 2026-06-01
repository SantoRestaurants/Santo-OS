# Santo AI OS North Star

Santo AI OS is Santo's internal operating brain.

It is not a generic chatbot and not a pile of isolated scripts. It is the layer that connects Santo's people, documents, workflows, approvals, exceptions, reports and decisions.

The long-term goal is company-wide operational memory:

- Remember how work happens.
- Track who owns each process.
- Know what documents are needed and where they live.
- Detect what is missing, blocked or awaiting review.
- Route safe actions through dashboard, email and later WhatsApp.
- Keep Supabase/Postgres as the source of truth.

The full system should eventually support Query Mode, Action Mode, reporting, presentations and department expansion, but those capabilities must be phased. The current build should preserve the vision without trying to build it all at once.

## P0 Principle

P0 proves the operating model, not the whole vision.

The first build must stay narrow:

- One domain.
- One primary workflow.
- One restaurant/unit first.
- One dashboard path.
- One notification channel.
- One review/approval model.
- One registry spine.

## P0 Domain

Admin / HR / Payroll / Accounting / Fiscal.

## P0 Primary Workflow

Corte Santo - Daily Sales Reconciliation.

## P0 Secondary Thin Validations

- XML SAT validation.
- Utility receipts matching.

These secondary workflows exist only to prove the foundation is reusable. They should not become full builds during P0.

Employee Document Intake appears in broader Claude instructions as a possible validation workflow, but it is not active P0 scope unless Santo explicitly reintroduces it.

## Current Sprint

The active sprint is a foundation sprint, not full P0 completion.

It succeeds when the base OS flow works with fixtures/synthetic data:

input -> workflow_run -> documents/tasks/exceptions -> events/watchdog -> dashboard.

## System Principles

- One backend, many channels: dashboard, Agent Mail, scheduler and future WhatsApp all go through the shared command handler.
- Third parties are pipes, not the brain.
- Human approval remains central.
- Every workflow should make Santo smarter by strengthening reusable structure, traceability and learning.
