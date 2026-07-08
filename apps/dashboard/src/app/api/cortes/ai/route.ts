import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/authz";

type AiRequestBody = {
  runId?: string;
  question?: string;
  unit?: string;
  businessDate?: string;
  selectedMonth?: string;
};

export async function POST(request: Request) {
  const auth = await authorizeRequest(["supervisor", "socio"]);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });
  const { supabase } = auth;

  const body = await request.json().catch(() => null) as AiRequestBody | null;
  const question = body?.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "Falta la pregunta." }, { status: 400 });
  }

  let effectiveDate = body?.businessDate || new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  let selectedMonth = body?.selectedMonth || effectiveDate.slice(0, 7);

  // 1. Fetch raw data: Daily records & Receivables
  let rawMonthlyData: any = {};
  const { data: dailyRecords } = await supabase
    .from("corte_daily_records")
    .select("*")
    .gte("business_date", `${selectedMonth}-01`)
    .lte("business_date", `${selectedMonth}-31`)
    .order("business_date", { ascending: true });

  const { data: receivables } = await supabase
    .from("corte_receivables")
    .select("receivable_key, opened_on, principal, settled_on, settled_principal, status")
    .or(`opened_on.gte.${selectedMonth}-01,settled_on.gte.${selectedMonth}-01`)
    .lte("opened_on", `${selectedMonth}-31`);

  rawMonthlyData = {
    mes: selectedMonth,
    ventas_diarias_totales: dailyRecords,
    cuentas_por_cobrar: receivables
  };

  // 2. Fetch Workflow Runs (Bank Reconciliation Data)
  // Fetch for the specific day to get exact deposits
  let reconciliationData: any = {};
  const { data: runData } = await supabase
    .from("workflow_runs")
    .select("business_date, output_payload")
    .eq("workflow_key", "corte_santo_daily_sales_reconciliation")
    .eq("source_channel", "agent_mail")
    .eq("business_date", effectiveDate)
    .order("created_at", { ascending: false })
    .limit(1);

  if (runData && runData.length > 0) {
    const payload = runData[0].output_payload || {};
    reconciliationData = payload.bank_reconciliation || {};
  } else {
    // Si no hay run en la fecha exacta, traemos el más reciente
    const { data: latestRun } = await supabase
      .from("workflow_runs")
      .select("business_date, output_payload")
      .eq("workflow_key", "corte_santo_daily_sales_reconciliation")
      .eq("source_channel", "agent_mail")
      .order("created_at", { ascending: false })
      .limit(1);
    if (latestRun && latestRun.length > 0) {
      const payload = latestRun[0].output_payload || {};
      reconciliationData = payload.bank_reconciliation || {};
      effectiveDate = latestRun[0].business_date;
    }
  }

  // 3. Build the prompt with ALL information
  const parts: string[] = [
    "Sos SantoBot, el experto analista de datos y financiero de Santo Restaurants. Le hablás a los socios.",
    "Reglas estrictas:",
    "1. Respondé EXCLUSIVAMENTE a la pregunta del usuario. No des reportes adicionales.",
    "2. Sé conciso y directo, sin rodeos. Da cifras exactas con el formato $0.00.",
    "3. IMPORTANTE: Para calcular depósitos (lo que ya entró al banco hoy) y pendientes (lo que falta por depositar), REVISA CUIDADOSAMENTE la sección DATOS DE CONCILIACIÓN BANCARIA DEL DÍA.",
    "   - Si preguntan por depósitos de BANORTE: Suma los montos de 'banorte_deposit' dentro del array 'batch_validation' que tengan status 'ok'. (Banorte procesa tarjetas de débito y crédito).",
    "   - Si preguntan por depósitos de AMERICAN EXPRESS: Suma los montos de 'deposit_amount' dentro del array 'amex_matches'.",
    "   - Para montos faltantes/pendientes, revisa el objeto 'pending_collections' (tiene llaves como 'amex', 'debito', 'credito').",
    "   - Si la información está en la data JSON, ¡haz el cálculo matemático internamente y responde con seguridad! NUNCA digas que no hay información si puedes calcularla sumando los campos mencionados.",
    "4. Si un registro en cuentas_por_cobrar tiene status 'settled', YA FUE DEPOSITADO.",
    "5. Si tras revisar exhaustivamente los JSON no encuentras los datos, responde 'No hay información registrada para ese cálculo'.",
    `DÍA DE CORTE: ${effectiveDate}`,
    "",
    "━━━ DATOS CRUDOS DE VENTAS Y CXC DEL MES ━━━",
    JSON.stringify(rawMonthlyData),
    "",
    "━━━ DATOS DE CONCILIACIÓN BANCARIA DEL DÍA ━━━",
    "Aquí tienes los detalles de lo que realmente ingresó al banco y lo que quedó pendiente para este corte:",
    JSON.stringify(reconciliationData),
    "",
    `PREGUNTA DEL USUARIO: ${question}`
  ];

  const prompt = parts.join("\n");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest", max_tokens: 600, temperature: 0.0,
          system: "Sos SantoBot, asistente financiero de Santo Restaurants.",
          messages: [{ role: "user", content: prompt }]
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const payload = await response.json();
        const answer = payload?.content?.map((block: { text?: string }) => block.text ?? "").join("").trim();
        if (answer) return NextResponse.json({ answer, mode: "llm_raw_data" });
      }
    } catch (e) {
      console.error("Claude API error:", e);
    }
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return NextResponse.json({ error: "No hay un proveedor de IA configurado." }, { status: 503 });
  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const gResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.0, maxOutputTokens: 600 } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!gResp.ok) return NextResponse.json({ error: "El asistente no pudo responder." }, { status: 502 });
    const gPayload = await gResp.json();
    const answer = gPayload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim();
    return NextResponse.json({ answer: answer || "No pude generar una respuesta.", mode: "llm_raw_data" });
  } catch (e) {
    console.error("Gemini API error:", e);
    return NextResponse.json({ error: "Timeout al contactar el asistente." }, { status: 504 });
  }
}
