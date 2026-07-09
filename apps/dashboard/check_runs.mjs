import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
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

async function check() {
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('business_date, status, output_payload')
    .gte('business_date', '2026-07-01')
    .order('business_date', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  
  for (const run of data) {
    const payload = run.output_payload || {};
    const bankRec = payload.bank_reconciliation?.pending_collections || payload.bank_stage?.bank_reconciliation?.pending_collections;
    const excelFalta = payload.revision_document?.falta_por_entrar || run.revision?.falta_por_entrar;
    
    console.log(`\n--- Run ${run.business_date} ---`);
    console.log(`Bank pending:`, JSON.stringify(bankRec, null, 2));
    console.log(`Excel falta:`, JSON.stringify(excelFalta, null, 2));
  }
}

check();
