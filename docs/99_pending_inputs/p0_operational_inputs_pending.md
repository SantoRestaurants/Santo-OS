# P0 Operational Inputs Pending

These are the confirmed missing inputs before later P0 PRs can safely finalize workflow logic.

## Confirmed So Far

- Corte reconciliation tolerance: `0` (Total Real must equal Total Sistema exactly; any difference -> `requires_review`).
- Active Corte unit: `SANTO` only for now (other units — SOOP, TIGRE, FIAMMA, REKO, SANTO LA, SECO, Do Central — remain out of scope until reintroduced).
- Corte intake mandatory attachments use the real corte email set; the corte Excel ("SANTO CORTE ...xlsx") and the Wansoft global report are required.
- Corte figures can be auto-extracted from the corte Excel (Option B). Any unmapped column -> `requires_review`.

## Needed From Santo Team

- Drive URLs, hierarchy, naming, folder IDs, My Drive vs Shared Drive location,
  and the Google identity that can write to each folder (for the SANTO REVISION report).
- Corte exception severities and reviewer routing (tolerance is confirmed at 0).
- Confirmation of the exact corte Excel column headers per unit so the
  `excel_layout.column_label_map` default matches production files (drives Option B extraction).
- How the "Falta por entrar en la cuenta" amounts (cobros AMEX/Uber/Rappi/Banorte/PayPal/CXC)
  should be sourced: manual input vs future automated bank-statement parsing.
- Restaurant/entity/RFC mappings and short codes.
- Agent Mail routing convention: subject prefixes, labels, senders or rules (`[CORTE]` preferred).
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
