import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve('../.env.local');
let url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
let key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!url || !key) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envLines = envContent.split('\n');
  for (const line of envLines) {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
      url = line.split('=')[1].trim();
    }
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
      key = line.split('=')[1].trim();
    }
    if (!key && line.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) {
      key = line.split('=')[1].trim();
    }
  }
}

const supabase = createClient(url, key);

async function run() {
  console.log("Fetching corte_daily_records for July...");
  const { data: records, error } = await supabase
    .from("corte_daily_records")
    .select("*")
    .gte("business_date", "2026-07-01")
    .order("business_date");

  if (error) {
    console.error(error);
    return;
  }

  const channels = ["amex", "debito", "credito", "efectivo", "uber_eats", "rappi"];

  for (const record of records) {
    // We mark July 1, 2, 3 as settled, and 4, 5, 6 as open
    const isSettled = record.business_date <= "2026-07-03";
    
    for (const channel of channels) {
      const principal = Number(record[channel]) || 0;
      if (principal <= 0) continue;

      const receivable_key = `${record.restaurant_id}:${record.business_date}:${channel}`;
      const status = isSettled ? "settled" : "open";
      const settled_principal = isSettled ? principal : 0;

      const payload = {
        restaurant_id: record.restaurant_id,
        receivable_key,
        opened_on: record.business_date,
        principal,
        settled_principal,
        status,
        settled_on: isSettled ? record.business_date : null,
        source_workflow_run_id: record.source_workflow_run_id,
        source_provider_message_id: "import_script_2026",
      };

      const { error: upsertError } = await supabase
        .from("corte_receivables")
        .upsert(payload, { onConflict: "receivable_key" });

      if (upsertError) {
        console.error(`Error upserting ${receivable_key}:`, upsertError);
      } else {
        console.log(`Upserted ${receivable_key} (Status: ${status}, Principal: ${principal})`);
      }
    }
  }

  console.log("Finished populating corte_receivables.");
}

run();
