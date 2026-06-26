"""Bulk-load forecast data into Supabase documents table."""
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

import requests


def load_env(path: str) -> dict:
    """Parse .env.local file into a dict."""
    env = {}
    if not os.path.exists(path):
        print(f"WARNING: {path} not found")
        return env
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            env[key] = value
    return env


def main():
    env = load_env(os.path.join(os.path.dirname(__file__), "..", "apps", "dashboard", ".env.local"))
    
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL", "")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not supabase_url or not service_key:
        print("ERROR: Missing Supabase env vars")
        sys.exit(1)

    json_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.expanduser("~"), "OneDrive", "Desktop", "santo", "forecasts_parsed.json"
    )

    if not os.path.exists(json_path):
        print(f"ERROR: File not found: {json_path}")
        sys.exit(1)

    with open(json_path, encoding="utf-8") as f:
        data = json.load(f)

    print(f"Found {len(data)} months to process\n")

    base_url = supabase_url.rstrip("/")
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }

    for month in data:
        source_hash = hashlib.sha256(
            json.dumps(month["vta_por_dia"], sort_keys=True).encode()
        ).hexdigest()
        
        doc_key = f"forecast:{month['month']}:{source_hash[:12]}"

        # Check if exists
        resp = requests.get(
            f"{base_url}/rest/v1/documents",
            headers={**headers, "Prefer": "return=representation"},
            params={
                "select": "id",
                "workflow_run_id": "is.null",
                "document_type": "eq.forecast_workbook",
                "document_key": f"eq.{doc_key}",
                "limit": "1",
            },
        )

        doc_row = {
            "workflow_run_id": None,
            "document_key": doc_key,
            "document_type": "forecast_workbook",
            "source_system": "system",
            "source_hash": source_hash,
            "status": "registered",
            "metadata": {
                "month": month["month"],
                "unit": month["unit"],
                "restaurant_key": month["restaurant_key"],
                "total_meta": month["total_meta"],
                "days": month["days"],
                "imported_from": month["filename"],
                "imported_at": datetime.now(timezone.utc).isoformat(),
                "vta_por_dia": month["vta_por_dia"],
            },
        }

        if resp.ok and resp.json():
            existing_id = resp.json()[0]["id"]
            upd_resp = requests.patch(
                f"{base_url}/rest/v1/documents",
                headers=headers,
                params={"id": f"eq.{existing_id}"},
                json=doc_row,
            )
            if upd_resp.ok:
                print(f"  UPDATED {month['month']:8s} ({month['unit']}) {month['days']:2d}d  META MXN {month['total_meta']:>14,.2f}")
            else:
                print(f"  UPDATE ERROR {month['month']}: {upd_resp.status_code} {upd_resp.text[:200]}")
        else:
            ins_resp = requests.post(
                f"{base_url}/rest/v1/documents",
                headers=headers,
                json=doc_row,
            )
            if ins_resp.ok:
                print(f"  INSERTED {month['month']:8s} ({month['unit']}) {month['days']:2d}d  META MXN {month['total_meta']:>14,.2f}")
            else:
                print(f"  INSERT ERROR {month['month']}: {ins_resp.status_code} {ins_resp.text[:200]}")

    print(f"\nDone. {len(data)} months processed.")


if __name__ == "__main__":
    main()
