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

if (!url || !key) {
  console.log('Missing env vars');
  process.exit(1);
}

const supabase = createClient(url, key);

async function check() {
  const { data, error } = await supabase
    .from('corte_receivables')
    .select('restaurant_id, receivable_key, opened_on, principal, settled_principal, status, restaurants(restaurant_key)')
    .order('opened_on', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }
  
  console.log('Open receivables count:', data?.length);
  if (data && data.length > 0) {
    console.log(data.slice(0, 5));
  } else {
    console.log("No open receivables found in corte_receivables.");
  }
}

check();
