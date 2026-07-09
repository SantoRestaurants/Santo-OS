
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
  const { data } = await supabase.from('email_intake')
    .select('body, subject')
    .ilike('subject', '%06 JULIO%')
    .limit(1)
    .single();
  console.log(data?.body);
}
check();

