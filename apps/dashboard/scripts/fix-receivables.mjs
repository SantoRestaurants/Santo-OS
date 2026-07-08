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
  const { data: runData } = await supabase.from('workflow_runs').select('output_payload').eq('business_date', '2026-07-05').single();
  const pendingItems = runData.output_payload.bank_reconciliation.pending_items;
  
  const pendingKeys = new Set();
  for (const item of pendingItems) {
    if (!item.channel || !item.source_date) continue;
    let ch = item.channel;
    if (ch === 'uber') ch = 'uber_eats';
    const key = `7d10b0a4-8b91-4818-b74d-962927352511:${item.source_date}:${ch}`;
    pendingKeys.add(key);
  }
  
  const keepOpen = new Set([
    '7d10b0a4-8b91-4818-b74d-962927352511:90348',
    '7d10b0a4-8b91-4818-b74d-962927352511:90359',
    '7d10b0a4-8b91-4818-b74d-962927352511:90484',
    '7d10b0a4-8b91-4818-b74d-962927352511:90487',
    '7d10b0a4-8b91-4818-b74d-962927352511:2026-06-24:785.00:928e1d7eabae'
  ]);
  
  const { data: allReceivables } = await supabase.from('corte_receivables').select('*');
  
  for (const rec of allReceivables) {
    let shouldBeOpen = false;
    if (rec.opened_on > '2026-07-05') {
      shouldBeOpen = true;
    } else if (pendingKeys.has(rec.receivable_key)) {
      shouldBeOpen = true;
    } else if (keepOpen.has(rec.receivable_key)) {
      shouldBeOpen = true;
    }
    
    if (shouldBeOpen && (rec.status !== 'open' || rec.settled_on !== null)) {
      await supabase.from('corte_receivables').update({ status: 'open', settled_principal: 0, settled_on: null }).eq('receivable_key', rec.receivable_key);
      console.log('Opened', rec.receivable_key);
    } else if (!shouldBeOpen && rec.status === 'open') {
      await supabase.from('corte_receivables').update({ status: 'settled', settled_principal: rec.principal, settled_on: '2026-07-05' }).eq('receivable_key', rec.receivable_key);
      console.log('Settled', rec.receivable_key);
    }
  }
  
  console.log('done');
}
run();
