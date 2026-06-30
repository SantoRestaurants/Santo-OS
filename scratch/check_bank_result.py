"""Check Jun 29 bank stage result - all runs."""
import os, json, httpx
from pathlib import Path

env_path = Path(r"C:\Users\dchac\Documents\Codex\SantoOS\apps\dashboard\.env.local")
env = {}
for l in env_path.read_text().splitlines():
    l = l.strip()
    if l and not l.startswith("#") and "=" in l:
        k, _, v = l.partition("=")
        env[k.strip()] = v.strip()

h = {"apikey": env["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_KEY']}"}
url = env["NEXT_PUBLIC_SUPABASE_URL"]

r = httpx.get(f"{url}/rest/v1/workflows?select=id&workflow_key=eq.corte_santo_daily_sales_reconciliation&limit=1", headers=h, timeout=30)
wfid = r.json()[0]["id"]

r = httpx.get(f"{url}/rest/v1/workflow_runs?select=id,business_date,status,source_channel,output_payload&workflow_id=eq.{wfid}&business_date=eq.2026-06-29&order=created_at.desc&limit=5", headers=h, timeout=30)

print(f"Runs for Jun 29: {len(r.json())}")
for run in r.json():
    op = (run.get("output_payload") or {})
    if isinstance(op, str): op = json.loads(op)
    stage = op.get("stage", "N/A")
    bank = op.get("bank_reconciliation") or {}
    bank_status = bank.get("status", "N/A")
    
    print(f"\n  id={run['id'][:8]}...")
    print(f"  status={run['status']} source={run['source_channel']}")
    print(f"  stage={stage} bank_status={bank_status}")
    
    # Show top keys
    print(f"  keys: {list(op.keys())[:10]}")
    
    if bank:
        pending = bank.get("pending_items", [])
        amex = bank.get("amex_matches", [])
        print(f"  AMEX matches: {len(amex)}, Pending items: {len(pending)}")
    
    ec = op.get("expected_collections") or []
    if ec:
        print(f"  Expected collections: {len(ec)}")
