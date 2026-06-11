# P0 Operational Inputs Pending

These are the confirmed missing inputs before later P0 PRs can safely finalize workflow logic.

## Needed From Santo Team

- Drive URLs, hierarchy, naming, folder IDs, My Drive vs Shared Drive location,
  and the Google identity that can write to each folder.
- Corte thresholds, severities and mandatory attachments.
- Reviewer map by exception type.
- Restaurant/entity/RFC mappings and short codes.
- Agent Mail routing convention: subject prefixes, labels, senders or rules.
- Utility template columns and marking/color rules.
- Confirm whether Utilities can write to Google Sheets in P0 or only record status in Supabase.
- At least one real anonymized or sanitized XML export from MiAdminXML for test fixtures.

## Operational Addendum Sections To Fill

The future Operational Addendum should not change architecture. It should fill confirmed configuration only:

- `drive_folder_map`: folders, permissions, hierarchy and naming.
- `corte_thresholds`: tolerances, severities, required attachments and reconciliation rules.
- `reviewer_map`: who reviews each exception type.
- `restaurant_entity_rfc_map`: restaurant/unit, legal entity, RFC and short code.
- `agent_mail_routing_rules`: prefixes, labels, senders and confirmed ignore rules.
- `utility_receipt_config`: providers, periods, template columns, matching rules, marking/color rules and Sheets scope.
- `xml_sat_config`: RFCs, periods, folders, XML types, trusted exports and sanitized fixtures.

## Build Boundary

PR 1 through PR 5 can start without these answers.

PR 6 can start partially.

PR 7 through PR 9 should wait for relevant confirmed inputs.

Employee Document Intake is future/P3+ and should not be built in P0 unless Santo explicitly reintroduces it.
