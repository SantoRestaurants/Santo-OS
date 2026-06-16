# Agent Mail

P0 Agent Mail intake service for Santo AI OS.

## What It Does

1. Polls the inbox `santoos@agentmail.to` for new messages.
2. Classifies email using confirmed subject-prefix rules.
3. Sends ambiguous email to `requires_review`.
4. Optionally writes email, document, workflow, review, and event records to Supabase.
5. Optionally mirrors classified attachments to confirmed Google Drive folders.

## Dry Run

```powershell
$env:AGENTMAIL_API_KEY="[runtime secret]"
python -m services.agent_mail.poller --config services/agent_mail/config.json
```

## Write To Supabase And Drive

```powershell
$env:AGENTMAIL_API_KEY="[runtime secret]"
$env:NEXT_PUBLIC_SUPABASE_URL="https://[project].supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="[runtime secret]"
$env:GOOGLE_DRIVE_CLIENT_ID="[runtime secret]"
$env:GOOGLE_DRIVE_CLIENT_SECRET="[runtime secret]"
$env:GOOGLE_DRIVE_REFRESH_TOKEN="[runtime secret]"
$env:GOOGLE_DRIVE_CONNECTOR_CONFIG="services/drive_connector/config.local.json"
$env:GEMINI_API_KEY="[runtime secret]"
$env:CORTE_SANTO_DRIVE_FOLDER_ID="[confirmed Corte Santo Drive folder id]"
python -m services.agent_mail.poller --config services/agent_mail/config.json --write
```

Drive is optional. If `GOOGLE_DRIVE_CONNECTOR_CONFIG` is not set, Agent Mail
continues to store document metadata and Supabase Storage evidence only. If the
Drive config, target folder, or credential is missing, the Drive write returns
`requires_review`.

When `corte_santo_automation.enabled=true`, classified `[CORTE]` emails also
run the Corte Santo initial stage: attachments are downloaded, the Corte Excel
is reconciled, Ingresos/Forecast are discovered from the confirmed Drive folder,
updated, and the supervisor notification is prepared/sent depending on dry-run
mode. Explicit `CORTE_SANTO_INGRESOS_FILE_ID` and
`CORTE_SANTO_FORECAST_FILE_ID` values are still supported, but production should
prefer `CORTE_SANTO_DRIVE_FOLDER_ID` or `CORTE_SANTO_WORKBOOKS_FOLDER_ID`.

Vision extraction uses Gemini in the confirmed test config. The Corte Excel
reconciles automatically, and Gemini reads the supporting photos needed for
detailed Ingresos channels such as debit, credit and tips. The bank-stage Drive
watcher can detect AMEX/Banorte uploads by filename signals or, when needed, by
sampling file content; the supervisor does not need exact filenames.

## Architecture

- `intake.py`: pure classification logic.
- `poller.py`: Agent Mail API, Supabase persistence, and optional Drive handoff.
- `config.json`: confirmed routing rules.
- `../drive_connector/`: confirmed-folder Drive write boundary.
