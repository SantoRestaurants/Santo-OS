# Agent Mail

P0 Agent Mail intake service for Santo AI OS.

## What it does

1. Polls the inbox `santoos@agentmail.to` for new messages
2. Classifies each email based on subject prefix:
   - `[CORTE]` → Corte Santo workflow
   - `[XML]` → XML SAT validation
   - `[UTILIDADES]` → Utility receipts
3. Unclassified or ambiguous emails → `requires_review` (never guesses)
4. Optionally writes results to Supabase (email_messages + events)

## Usage

### Dry run (just classify, don't write)

```bash
export AGENTMAIL_API_KEY="am_us_..."
python -m services.agent_mail.poller --config services/agent_mail/config.json
```

### Write to Supabase

```bash
export AGENTMAIL_API_KEY="am_us_..."
export SUPABASE_URL="https://xxx.supabase.co"
export SUPABASE_SERVICE_KEY="eyJ..."
python -m services.agent_mail.poller --config services/agent_mail/config.json --write
```

### Watch mode (poll every 30s)

```bash
python -m services.agent_mail.poller --config services/agent_mail/config.json --write --watch
```

## Configuration

`config.json` defines the routing rules:

```json
{
  "confirmed": true,
  "subject_prefixes": {
    "[CORTE]": "corte_santo_daily_sales_reconciliation",
    "[XML]": "xml_sat_validation",
    "[UTILIDADES]": "utility_receipts_matching"
  },
  "ignored_subject_prefixes": ["[FYI]", "[AUTO]", "[NOREPLY]"]
}
```

## Architecture

- `intake.py` — Pure classification logic (no I/O, testable)
- `poller.py` — AgentMail API client + Supabase writer + polling loop
- `config.json` — Routing rules (confirmed, not hardcoded in code)

## Inbox

- Address: `santoos@agentmail.to`
- Provider: AgentMail (API-first, no OAuth/Gmail complexity)
- For production: will be swapped to a real Santo domain inbox
