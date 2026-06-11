# P0 Demo With Alonso

## Objective

Show that the P0 operating model works end to end and use the meeting to close
the remaining operational configuration. Do not present unconfirmed business
rules as finished.

## Demo Route

Open:

`http://localhost:3000/?demo=1`

## Suggested Talk Track

1. Start with the three P0 workflows: Corte Santo, XML SAT validation, and
   Utility Receipts.
2. Walk through the Corte Santo timeline:
   Agent Mail -> classification -> workflow records -> Drive evidence ->
   human review.
3. Explain that Supabase is the operating source of truth and Drive stores
   evidence only.
4. Show that an unknown Drive folder, missing threshold, or unknown reviewer
   becomes `requires_review`.
5. Close the meeting by confirming the six decisions shown in the dashboard.

## Drive Activation Inputs

For each P0 workflow, confirm:

- Stable `folder_key`.
- Google Drive folder ID.
- Human-readable Drive URL.
- Whether the folder is in My Drive or a Shared Drive.
- Which Google identity can write to it.
- Final hierarchy and naming convention.

The connector supports Shared Drives and only writes to confirmed folder IDs.

## Remaining P0 Operational Decisions

- First restaurant/unit, legal entity, RFC, and short code.
- Corte mandatory attachments.
- Corte tolerances and exception severities.
- Reviewer by exception type.
- Definitive Agent Mail subject convention.
- Drive hierarchy, names, IDs, permissions, and responsible identity.
- Sanitized MiAdminXML fixture.
- Utility template and Google Sheets scope.
