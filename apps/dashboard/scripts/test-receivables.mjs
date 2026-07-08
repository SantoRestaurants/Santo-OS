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
  const { data: runs } = await supabase.from('workflow_runs').select('*').order('created_at', { ascending: false });

  const unitReceivables = receivables.filter(r => r.restaurants?.restaurant_key === 'SANTO' || r.restaurants?.[0]?.restaurant_key === 'SANTO');
  
  console.log("unitReceivables count:", unitReceivables.length);
  const openReceivables = unitReceivables.filter(r => r.status === 'open');
  console.log("open unitReceivables count:", openReceivables.length);
  
}
run();
