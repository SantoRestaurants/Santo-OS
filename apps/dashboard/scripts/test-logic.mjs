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
  const { data: receivables } = await supabase.from('corte_receivables').select(`*, restaurants(restaurant_key)`);

  const unitReceivables = receivables.filter((r) => {
    const rs = r.restaurants;
    const rawKey = Array.isArray(rs) ? rs[0]?.restaurant_key : rs?.restaurant_key;
    const key = rawKey === "default_restaurant_confirm" ? "SANTO" : rawKey?.toUpperCase();
    return key === 'SANTO';
  });

  const entriesMap = new Map();
  for (const rec of unitReceivables) {
    if (rec.status !== "open") continue;
    const amount = Number(rec.principal) - Number(rec.settled_principal);
    if (amount <= 0 || Number.isNaN(amount)) continue;
    
    // Extract channel from receivable_key (e.g. restaurant_id:date:channel)
    const parts = rec.receivable_key.split(':');
    const channel = parts.length >= 3 ? parts[2] : rec.receivable_key;
    
    entriesMap.set(channel, (entriesMap.get(channel) ?? 0) + amount);
  }

  const entries = Array.from(entriesMap.entries())
    .map(([channel, amount]) => ({ channel, amount }))
    .sort((a, b) => b.amount - a.amount || a.channel.localeCompare(b.channel));
  
  console.log("Entries:", entries);
}
run();
