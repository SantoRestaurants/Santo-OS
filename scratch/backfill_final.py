"""
Backfill final v2 - sin metas (meta_vta = null/0, diferencia = 0).
El usuario cargará las metas después con PDF.
"""
import httpx
import openpyxl
import datetime

SUPABASE_URL = "https://tstesjnefidyxryitfmi.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRzdGVzam5lZmlkeXhyeWl0Zm1pIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDMyNTczNiwiZXhwIjoyMDk1OTAxNzM2fQ.44AE5MDIiReSTgUxzY5Xl83hfklhKzocgEJXzg48Ee4"

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

BASE_2026 = "C:/Users/dchac/OneDrive/Desktop/santo"
BASE_2025 = "C:/Users/dchac/OneDrive/Desktop/santo/2025"

FILES = [
    (f"{BASE_2025}/06.Santo_Ingresos Junio 2025.xlsx",      6,  2025),
    (f"{BASE_2025}/07.Santo_Ingresos Julio 2025.xlsx",       7,  2025),
    (f"{BASE_2025}/10.Santo_Ingresos Octubre 2025.xlsx",     10, 2025),
    (f"{BASE_2025}/11.Santo_Ingresos Noviembre 2025.xlsx",   11, 2025),
    (f"{BASE_2025}/12.Santo_Ingresos Diciembre 2025.xlsx",   12, 2025),
    (f"{BASE_2026}/01. Santo_Ingresos Enero 2026.xlsx",      1,  2026),
    (f"{BASE_2026}/02. Santo_Ingresos Febrero 2026.xlsx",    2,  2026),
    (f"{BASE_2026}/03. Santo_Ingresos Marzo 2026.xlsx",      3,  2026),
    (f"{BASE_2026}/04. Santo_Ingresos Abril 2026.xlsx",      4,  2026),
    (f"{BASE_2026}/05. Santo_Ingresos Mayo 2026.xlsx",       5,  2026),
    (f"{BASE_2026}/06. Santo_Ingresos Junio 2026.xlsx",      6,  2026),
]

DIAS_ES = {0: "LUN", 1: "MAR", 2: "MIÉ", 3: "JUE", 4: "VIE", 5: "SÁB", 6: "DOM"}


def to_float(v):
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def parse_row_date(fecha_raw, forced_month, forced_year):
    if isinstance(fecha_raw, datetime.datetime):
        dt = fecha_raw.replace(year=forced_year, month=forced_month)
        return dt.strftime("%Y-%m-%d"), DIAS_ES.get(dt.weekday(), "DIA")
    if isinstance(fecha_raw, datetime.date):
        dt = datetime.date(forced_year, forced_month, fecha_raw.day)
        wd = datetime.datetime(forced_year, forced_month, fecha_raw.day).weekday()
        return dt.strftime("%Y-%m-%d"), DIAS_ES.get(wd, "DIA")
    if isinstance(fecha_raw, str):
        s = fecha_raw.strip().split(" ")[0]
        parts = s.split("-")
        if len(parts) == 3:
            day = int(parts[2])
            dt = datetime.date(forced_year, forced_month, day)
            wd = datetime.datetime(forced_year, forced_month, day).weekday()
            return dt.strftime("%Y-%m-%d"), DIAS_ES.get(wd, "DIA")
    return None, None


def parse_file(filepath, forced_month, forced_year):
    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active
    days = []

    for row in ws.iter_rows(min_row=5, values_only=True):
        fecha_raw = row[1]
        if fecha_raw is None:
            continue
        if isinstance(fecha_raw, str) and "total" in fecha_raw.lower():
            continue

        fecha_str, dia_str = parse_row_date(fecha_raw, forced_month, forced_year)
        if not fecha_str:
            continue

        parsed = datetime.datetime.strptime(fecha_str, "%Y-%m-%d")
        if parsed.month != forced_month or parsed.year != forced_year:
            continue

        venta_bruta = to_float(row[19])  # col T - Venta Bruta neta

        if venta_bruta <= 0:
            continue

        # Channels
        amex      = to_float(row[2])
        debito    = to_float(row[3])
        credito   = to_float(row[4])
        efectivo  = to_float(row[5])
        paypal    = to_float(row[7])
        ubereats  = to_float(row[9])
        rappi     = to_float(row[11])
        propinas  = to_float(row[17])
        total_bruto = to_float(row[14])

        days.append({
            "fecha":       fecha_str,
            "dia":         dia_str,
            "venta_real":  round(venta_bruta, 2),
            # NO meta_vta — user will provide later
            "canales": {
                "amex":        round(amex, 2),
                "debito":      round(debito, 2),
                "credito":     round(credito, 2),
                "efectivo":    round(efectivo, 2),
                "paypal":      round(paypal, 2),
                "ubereats":    round(ubereats, 2),
                "rappi":       round(rappi, 2),
                "propinas":    round(propinas, 2),
                "total_bruto": round(total_bruto, 2),
            }
        })

    days.sort(key=lambda d: d["fecha"])
    return days


def build_run_payload(day: dict, all_month_days: list):
    mes_venta = sum(d["venta_real"] for d in all_month_days)

    return {
        "revision_document": {
            "business_date": day["fecha"],
            "vta_por_dia": [
                {
                    "dia":        d["dia"],
                    "fecha":      d["fecha"],
                    "meta_vta":   None,        # no meta yet
                    "venta_real": d["venta_real"],
                    "diferencia": None,        # no meta -> no diferencia
                }
                for d in all_month_days
            ],
            "vta_al_dia": {
                "meta_vta":       None,
                "venta_real":     round(mes_venta, 2),
                "diferencia":     None,
                "pct_diferencia": None,
            },
            "vta_meta_mes": {
                "meta_vta":   None,
                "venta_real": round(mes_venta, 2),
                "diferencia": None,
            },
            "saldos": {
                "prov_aguinaldos": 0,
                "saldo_banorte":   round(mes_venta, 2),
                "prov_utilidades": 0,
                "total":           round(mes_venta, 2),
            },
            "reconciliation_totals": {
                "total_real":    day["venta_real"],
                "total_sistema": day["venta_real"],
                "difference":    0,
                "tolerance":     500,
            },
            "formato_corte": "BIEN",
        },
        "income_channels": day["canales"],
        "income_register": day["canales"],
    }


def clean_old_backfill(client):
    resp = client.get(
        f"{SUPABASE_URL}/rest/v1/workflow_runs?idempotency_key=like.backfill_*&select=id,idempotency_key",
        headers=HEADERS
    )
    rows = resp.json()
    if not isinstance(rows, list):
        print("Warning:", rows)
        return
    for row in rows:
        r = client.delete(f"{SUPABASE_URL}/rest/v1/workflow_runs?id=eq.{row['id']}", headers=HEADERS)
        print(f"  Deleted {row['idempotency_key']} (HTTP {r.status_code})")


def main():
    with httpx.Client(timeout=30) as client:
        r = client.get(f"{SUPABASE_URL}/rest/v1/workflows?workflow_key=eq.corte_santo_daily_sales_reconciliation&select=id", headers=HEADERS)
        workflow_id = r.json()[0]["id"]

        r = client.get(f"{SUPABASE_URL}/rest/v1/restaurants?restaurant_key=eq.default_restaurant_confirm&select=id,legal_entity_id", headers=HEADERS)
        restaurant_id = r.json()[0]["id"]
        legal_entity_id = r.json()[0]["legal_entity_id"]

        print("Cleaning old backfill records...")
        clean_old_backfill(client)

        total_inserted = 0
        total_errors   = 0

        for filepath, month, year in FILES:
            print(f"\nProcessing {filepath}...")
            days = parse_file(filepath, month, year)
            print(f"  Found {len(days)} valid days")

            for day in days:
                bdate = day["fecha"]
                payload = build_run_payload(day, days)

                run_data = {
                    "workflow_id":     workflow_id,
                    "restaurant_id":   restaurant_id,
                    "legal_entity_id": legal_entity_id,
                    "business_date":   bdate,
                    "status":          "completed",
                    "source_channel":  "agent_mail",
                    "idempotency_key": f"backfill_{bdate}",
                    "input_payload":   {"source": filepath.split("/")[-1]},
                    "output_payload":  payload,
                }

                resp = client.post(f"{SUPABASE_URL}/rest/v1/workflow_runs", headers=HEADERS, json=run_data)
                if resp.status_code in (200, 201):
                    total_inserted += 1
                else:
                    print(f"    ERROR {bdate}: {resp.status_code} {resp.text[:200]}")
                    total_errors += 1

        print(f"\nDone! Inserted: {total_inserted}, Errors: {total_errors}")


if __name__ == "__main__":
    main()
