---
type: workflow_skill
title: Utility Receipts Matching
description: Thin P0 workflow for registering utility receipt metadata, documents, and review status without autonomous payments or provider portal actions.
resource: workflows/utilities/
tags: [p0, utilities, receipts, matching, review]
timestamp: 2026-06-21T00:00:00-06:00
---

# Utilities Receipt Matching

## Purpose

Receives utility receipt metadata (CFE, agua, gas) via Agent Mail or dashboard,
registers the receipt in workflow_runs and documents, and flags for review if
any required data is missing.

## Execution Type

- **execution_environment**: local
- **requires_local_machine**: false
- **requires_human_review**: true
- **requires_sensitive_credentials**: false
- **allowed_trigger_channels**: agent_mail, dashboard

## Workflow Key

`utility_receipts_matching`

## Input

- `provider`: CFE | agua | gas (utility provider)
- `amount`: numeric total on the receipt
- `due_date`: payment due date (ISO date string)
- `service_number`: utility service/account number
- `documents`: optional list of attached document metadata

## Output

- Workflow run record registered in Supabase
- Document record(s) created for receipt files
- Status: `requires_review` if any field is missing or unconfirmed
- Status: `registered` if all metadata is complete

## Behavior

1. Validate that provider matches a known provider in config.
2. Validate that amount, due_date, and service_number are present.
3. Register the workflow run.
4. Register document records for any attachments.
5. If anything is missing → `requires_review`.
6. Never mark as `completed` — always require human review for payment.

## Safety

- Does NOT make payments.
- Does NOT connect to utility provider portals.
- Only registers receipt metadata for human review.
