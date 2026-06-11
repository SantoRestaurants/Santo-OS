# Google Drive Connector

This connector saves workflow documents to confirmed Google Drive folders while
keeping Supabase/Postgres as the source of truth.

## Safety Rules

- Folder names and IDs come from confirmed configuration.
- Unknown or unconfirmed folders return `requires_review`.
- Missing credentials return `requires_review`.
- `dry_run` proposes the document record and audit event without writing.
- Shared Drives are supported with `supportsAllDrives=true`.

## Configuration

1. Copy `config.example.json` outside the repository or replace placeholders
   only after Alonso confirms the Drive hierarchy.
2. Set `GOOGLE_DRIVE_ACCESS_TOKEN` in the runtime secret store.
3. Grant the Google identity access to the target folders or Shared Drive.

## Demo

```powershell
python -m services.drive_connector.connector --input services/drive_connector/fixtures/demo_upload.json --config services/drive_connector/fixtures/demo_config.json --dry-run
```
