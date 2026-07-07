const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read .env.local manually
const envPath = path.join(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
});

const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
    const { data, error } = await supabase
        .from('workflow_runs')
        .select('business_date, status, output_payload')
        .eq('workflow_key', 'corte_santo_daily_sales_reconciliation')
        .order('business_date', { ascending: false })
        .limit(15);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('\nÚltimos 15 días con datos:\n');
    data.forEach(run => {
        const hasBankRec = run.output_payload?.bank_reconciliation;
        const hasAmexMatches = hasBankRec?.amex_matches?.length > 0;
        const amexDeposited = hasAmexMatches
            ? hasBankRec.amex_matches.reduce((sum, m) => sum + (m.deposit_amount || 0), 0)
            : 0;

        console.log(
            `${run.business_date} [${run.status}]: ` +
            `${hasBankRec ? '✅ Bancos' : '❌ Sin bancos'} ` +
            (hasAmexMatches ? `(AMEX depositado: $${amexDeposited.toFixed(2)})` : '')
        );
    });

    process.exit(0);
})();
