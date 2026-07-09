
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
async function check() {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  let url = '', key = '';
  for (const line of envContent.split('\n')) {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) key = line.split('=')[1].trim();
  }
  const supabase = createClient(url, key);
  
  const { data, error } = await supabase.from('workflow_runs')
    .update({ status: 'queued' })
    .eq('business_date', '2026-07-06');
    
  console.log(error || 'Updated July 6th to queued!');
}
check();

