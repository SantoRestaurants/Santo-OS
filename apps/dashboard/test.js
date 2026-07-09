
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
  const { data } = await supabase.from('workflow_runs')
    .select('id, business_date, status, requires_review_reason, output_payload, created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  for (const r of data) {
      console.log('ID:', r.id, 'Date:', r.business_date, 'Status:', r.status);
      console.log('Reason:', r.requires_review_reason);
      if (r.output_payload && r.output_payload.revision_document) {
          const rev = r.output_payload.revision_document;
          console.log('Falta entrar:', rev.falta_por_entrar);
          console.log('Exceptions:', r.output_payload.bank_reconciliation?.exceptions);
          console.log('Missing funds:', r.output_payload.bank_reconciliation?.missing_funds);
      }
      console.log('---');
  }
}
check();

