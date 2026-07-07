import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/authz";
// Removed hardcoded SQL functions. The LLM will now use raw data to answer directly.

export async function POST(request: Request) {
  const auth = await authorizeRequest(["supervisor", "socio"]);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });
  const { supabase } = auth;

  const body = await request.json().catch(() => null) as AiRequestBody | null;
  const runId = body?.runId;
  const question = body?.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "Falta la pregunta." }, { status: 400 });
  }

  let run: any = null;
  let effectiveDate: string | null = null;
  let selectedMonth = body?.selectedMonth;

  // Fetch run if runId provided and not a stub
  if (runId && runId !== "stub-today") {
    const { data, error } = await supabase
      .from("workflow_runs")
      .select("id,business_date,status,source_channel,requires_review_reason,created_at,output_payload")
      .eq("id", runId)
      .single();
    if (!error && data) {
      run = data;
      effectiveDate = data.business_date;
      selectedMonth = selectedMonth || data.business_date?.slice(0, 7);
    }
  }

  // If stub or no run, use businessDate from body or today
  if (!effectiveDate) {
    effectiveDate = body?.businessDate || new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    selectedMonth = selectedMonth || effectiveDate.slice(0, 7);
  }

  // ========================================
  // FETCH RAW DATA FOR LLM AS REQUESTED BY USER
  // ========================================
  let rawMonthlyData: any = {};
  if (selectedMonth) {
    try {
      const { data: dailyRecords } = await supabase
        .from("corte_daily_records")
        .select("*")
        .gte("business_date", `${selectedMonth}-01`)
        .lte("business_date", `${selectedMonth}-31`)
        .order("business_date", { ascending: true });

      const { data: receivables } = await supabase
        .from("corte_receivables")
        .select("receivable_key, opened_on, principal, settled_on, settled_principal, status, created_at, updated_at")
        .or(`opened_on.gte.${selectedMonth}-01,settled_on.gte.${selectedMonth}-01`)
        .lte("opened_on", `${selectedMonth}-31`)
        .order("opened_on", { ascending: true });

      rawMonthlyData = {
        mes: selectedMonth,
        ventas_diarias_totales: dailyRecords,
        cuentas_por_cobrar: receivables
      };
    } catch (e) {
      console.error("Error fetching raw month data:", e);
    }
  }

  // ========================================
  // USE LLM (Claude/Gemini) WITH FULL CONTEXT
  // All questions go through LLM for narrative analysis
  // ========================================
  let contextRun = run;

  // If no run or stub, find the latest run with data
  if (!run || !run.output_payload || Object.keys(run.output_payload).length === 0 || run?.status === "requires_review") {
    const { data: latestRun } = await supabase
      .from("workflow_runs")
      .select("id,business_date,status,source_channel,requires_review_reason,created_at,output_payload")
      .eq("workflow_key", "corte_santo_daily_sales_reconciliation")
      .eq("source_channel", "agent_mail")
      .neq("status", "requires_review")
      .not("output_payload", "is", null)
      .order("business_date", { ascending: false })
      .limit(1)
      .single();

    if (latestRun) {
      contextRun = latestRun;
      if (!effectiveDate || effectiveDate === new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" })) {
        effectiveDate = latestRun.business_date;
        console.log(`[AI] Using latest available data from ${effectiveDate}`);
      }
    }
  }

  // ========================================
  // USE LLM (Claude/Gemini) with compact context
  // Only for questions that require narrative analysis
  // ========================================
  const parts: string[] = [
    "Sos SantoBot, el experto analista de datos y financiero de Santo Restaurants. Le hablás a los socios.",
    "Reglas estrictas:",
    "1. Respondé EXCLUSIVAMENTE a la pregunta del usuario. No des reportes de ventas, faltantes o pronósticos a menos que te lo hayan preguntado explícitamente.",
    "2. Sé conciso y directo, sin rodeos. Da cifras exactas con el formato $0.00.",
    "3. Para calcular conciliaciones o faltantes, confía ÚNICAMENTE en la tabla 'cuentas_por_cobrar' inyectada abajo. Esta tabla tiene la verdad absoluta sobre qué está pagado (status: settled) y qué falta (status: pending).",
    "4. Si un registro en cuentas_por_cobrar tiene status 'settled', YA FUE DEPOSITADO Y CONCILIADO en la fecha 'settled_on'. No digas que faltan datos de conciliación si puedes ver los datos aquí.",
    "5. Nunca inventes cifras. Si en toda la tabla inyectada no hay información, di 'No hay información registrada para ese cálculo'.",
    "6. IMPORTANTE: Si te preguntan por una terminal específica (ej. Banorte, Clip, MercadoPago) y no ves ese nombre explícito en los datos (los canales comunes son amex, debito, credito, efectivo, uber_eats, rappi), asume que las ventas de tarjetas ('credito' y 'debito') procesan por esa terminal, a menos que el nombre no encaje en absoluto. Aún así, si no estás seguro de la equivalencia, di 'No tengo el dato desglosado por esa terminal específica'. No respondas con la Venta Bruta general si te preguntan por una terminal o canal.",
    ""
  ];

  if (effectiveDate !== (run?.business_date || body?.businessDate)) {
    parts.push(`NOTA INTERNA: El día exacto pedido no tiene run, pero tienes los datos crudos abajo.`);
  }
  if (body?.unit) parts.push("", `Unidad: ${body.unit}`);

  if (rawMonthlyData && Object.keys(rawMonthlyData).length > 0) {
    parts.push(
      "",
      "━━━ DATOS CRUDOS DEL MES PARA ANÁLISIS ━━━",
      "Aquí tienes TODOS los datos crudos de ventas y cuentas por cobrar del mes solicitado.",
      "Para preguntas de conciliación, depósitos o pendientes: usa 'cuentas_por_cobrar'. Si un registro tiene status 'settled', significa que el depósito ya entró al banco (conciliado) en la fecha 'settled_on'. Si dice 'pending', falta por entrar. Esto te permite calcular fechas cruzadas (ej. ventas de mayo pagadas en junio) y responder a la conciliación implícita.",
      "Si te piden sumar depósitos o ventas, suma directamente de esta data estructurada.",
      JSON.stringify(rawMonthlyData)
    );
  }

  parts.push("", `PREGUNTA: ${question}`, "", "Respondé solo lo que te preguntaron con los datos provistos. Sé preciso con cifras y porcentajes.");

  const prompt = parts.join("\n");

  // Try Claude first (primary provider)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest", max_tokens: 600, temperature: 0.2,
          system: "Sos SantoBot, asistente financiero de Santo Restaurants.",
          messages: [{ role: "user", content: prompt }]
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const payload = await response.json();
        const answer = payload?.content?.map((block: { text?: string }) => block.text ?? "").join("").trim();
        if (answer) return NextResponse.json({ answer, mode: "llm" });
      }
    } catch (e) {
      console.error("Claude API error:", e);
    }
  }

  // Gemini fallback
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return NextResponse.json({ error: "No hay un proveedor de IA aprobado y configurado." }, { status: 503 });
  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const gResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 600 } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!gResp.ok) return NextResponse.json({ error: "El asistente no pudo responder." }, { status: 502 });
    const gPayload = await gResp.json();
    const answer = gPayload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim();
    return NextResponse.json({ answer: answer || "No pude generar una respuesta.", mode: "llm" });
  } catch (e) {
    console.error("Gemini API error:", e);
    return NextResponse.json({ error: "Timeout al contactar el asistente." }, { status: 504 });
  }
}
