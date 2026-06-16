# P0 Operational Inputs Pending

These are the confirmed missing inputs before later P0 PRs can safely finalize workflow logic.

## Confirmed So Far

- Corte reconciliation tolerance: `0` (Total Real must equal Total Sistema exactly; any difference -> `requires_review`).
- Active Corte unit: `SANTO` only for now (other units — SOOP, TIGRE, FIAMMA, REKO, SANTO LA, SECO, Do Central — remain out of scope until reintroduced).
- Corte intake mandatory attachments use the real corte email set; the corte Excel ("SANTO CORTE ...xlsx") and the Wansoft global report are required.
- Corte figures can be auto-extracted from the corte Excel (Option B). Any unmapped column -> `requires_review`.
- The 35-page `Corte Santo.pdf` is the step-by-step operating reference. Its
  implementation interpretation is tracked in
  `docs/04_workflows/corte_santo_operating_procedure.md`.
- Monthly Ingresos registration records AMEX + debit + credit tips separately,
  uses the lower supported tip total when evidence differs, and adds dish
  courtesies to cash.
- Banorte generally settles the next day; AMEX in 3-5 days; Uber on Mondays for
  the prior Monday-Sunday period; Rappi on Fridays for its weekly period.
- Corte/REVISION Drive folder supplied:
  `1sN9QP54zdwgprH0-LUJwCVLtd4OY9vsL`.
- Corte supervisor notification recipient:
  `developer@santorestaurants.com`.
- The supplied Forecast is the June monthly projection template. A complete
  stale-date projection series may be rebased to the Corte month while
  preserving its projection values.

## Needed From Santo Team

- Drive URLs, hierarchy, naming, folder IDs, My Drive vs Shared Drive location,
  and the Google identity that can write to each folder (for the SANTO REVISION report).
- Corte exception severities and reviewer routing (tolerance is confirmed at 0).
- Confirmation of the exact corte Excel column headers per unit so the
  `excel_layout.column_label_map` default matches production files (drives Option B extraction).
- Exact PayPal settlement/matching rule and source evidence.
- Confirmation of whether Rappi's operational period ends Thursday or Friday;
  the PDF contains both phrasings.
- Drive file IDs for the active SANTO Ingresos and Forecast workbooks, plus the
  folder ID watched for AMEX and Banorte uploads. Confirm whether the supplied
  Corte/REVISION folder is also the bank-upload watcher folder.
- Stable production credentials for Drive and Agent Mail. The local Vercel CLI
  can see the linked `apps/dashboard` project, but `vercel env ls` does not show
  `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET` or
  `GOOGLE_DRIVE_REFRESH_TOKEN` there yet. These must be added to the exact
  Vercel project/environment before live Drive verification.
- Share the supplied bank-upload folder with the currently connected Google
  Drive identity `dantecastelaou@gmail.com` for the E2E test. Google currently
  returns `404 File not found` for that identity.
- Confirm the dedicated Santo production Google identity that will own the
  stable Drive OAuth/service credential; do not depend on a personal account or
  short-lived access token in production.
- Confirmation of the persisted expected-collections ledger used when the bank
  stage resumes the original workflow run.
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
