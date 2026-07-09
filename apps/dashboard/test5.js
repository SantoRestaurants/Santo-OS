
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
    .select('id, business_date, output_payload, input_payload')
    .order('created_at', { ascending: false })
    .limit(10);
  for (const r of data) {
     const str = JSON.stringify(r);
     if (str.includes('535')) {
         console.log('Found 535 in date:', r.business_date);
         if (r.output_payload?.corte_santo_initial_stage?.workflow_result) {
            console.log('cxc_events:', r.output_payload.corte_santo_initial_stage.workflow_result.workflow_run?.canonical_evidence?.cxc_events);
         } else if (r.output_payload?.canonical_evidence?.cxc_events) {
            console.log('cxc_events:', r.output_payload.canonical_evidence.cxc_events);
         } else {
             // check email subject/body
             console.log('input:', r.input_payload);
         }
     }
  }
}
check();

