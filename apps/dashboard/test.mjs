
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
async function test() {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  let url = '', key = '';
  for (const line of envContent.split('\n')) {
    if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) url = line.split('=')[1].trim();
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) key = line.split('=')[1].trim();
  }
  const supabase = createClient(url, key);
  
  const selectedMonth = '2026-07';
  
  const { data: dailyRecords } = await supabase.from('corte_daily_records').select('*').gte('business_date', selectedMonth + '-01').lte('business_date', selectedMonth + '-31');
  const { data: receivables } = await supabase.from('corte_receivables').select('receivable_key, opened_on, principal, settled_on, settled_principal, status').or('opened_on.gte.' + selectedMonth + '-01,settled_on.gte.' + selectedMonth + '-01').lte('opened_on', selectedMonth + '-31');
  
  const rawMonthlyData = {
    mes: selectedMonth,
    ventas_diarias_totales: dailyRecords,
    cuentas_por_cobrar: receivables
  };

  const parts = [
    'Sos SantoBot, el experto analista de datos y financiero de Santo Restaurants. Le hablás a los socios.',
    'Reglas estrictas:',
    '1. Respondé EXCLUSIVAMENTE a la pregunta del usuario. No des reportes de ventas, faltantes o pronósticos a menos que te lo hayan preguntado explícitamente.',
    '2. Sé conciso y directo, sin rodeos. Da cifras exactas con el formato .00.',
    '3. Para calcular conciliaciones o faltantes, confía ÚNICAMENTE en la tabla cuentas_por_cobrar inyectada abajo. Esta tabla tiene la verdad absoluta sobre qué está pagado (status: settled) y qué falta (status: pending).',
    '4. Si un registro en cuentas_por_cobrar tiene status settled, YA FUE DEPOSITADO Y CONCILIADO en la fecha settled_on. No digas que faltan datos de conciliación si puedes ver los datos aquí.',
    '5. Nunca inventes cifras. Si en toda la tabla inyectada no hay información, di No hay información registrada para ese cálculo.',
    '',
    '??? DATOS CRUDOS DEL MES PARA ANÁLISIS ???',
    'Aquí tienes TODOS los datos crudos de ventas y cuentas por cobrar del mes solicitado.',
    'Para preguntas de conciliación, depósitos o pendientes: usa cuentas_por_cobrar. Si un registro tiene status settled, significa que el depósito ya entró al banco (conciliado) en la fecha settled_on. Si dice pending, falta por entrar. Esto te permite calcular fechas cruzadas (ej. ventas de mayo pagadas en junio) y responder a la conciliación implícita.',
    'Si te piden sumar depósitos o ventas, suma directamente de esta data estructurada.',
    JSON.stringify(rawMonthlyData),
    '',
    'PREGUNTA: ¿Cuánto falta por depositarse en la cuenta bancaria de las ventas procesadas por American Express de julio?',
    '',
    'Respondé solo lo que te preguntaron con los datos provistos. Sé preciso con cifras y porcentajes.'
  ];
  
  const prompt = parts.join('\n');
  
  let apiKey = '';
  for (const line of envContent.split('\n')) {
    if (line.startsWith('GEMINI_API_KEY=')) apiKey = line.split('=')[1].trim();
  }
  
  if (!apiKey) {
     console.log('No GEMINI_API_KEY, skipping actual test call');
     return;
  }
  
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 600 } })
  });
  
  const data = await res.json();
  console.log('AI RESPONSE:', data.candidates[0].content.parts[0].text);
}
test();

