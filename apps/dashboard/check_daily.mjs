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
    .from('corte_daily_records')
    .select('*')
    .gte('business_date', '2026-07-01')
    .order('business_date', { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  
  console.log(data);
}

check();
