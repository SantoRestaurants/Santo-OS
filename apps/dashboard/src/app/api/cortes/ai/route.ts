import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/authz";
import { classifyQuestion, parseDateFromQuestion, calculateDeterministicAnswer } from "@/lib/ai-deterministic-queries";

type AiRequestBody = {
  runId?: string;
  question?: string;
  unit?: string;
  businessDate?: string;
  weekContext?: { totalVendido: number; totalMeta: number; diasConCorte: number; cortes: Array<{ fecha: string; venta: number; meta: number | null; status: string }> };
  monthContext?: { totalVendido: number; totalMeta: number; progressPct: number };
  selectedMonth?: string;
};

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

  let effectiveDate: string | null = null;
  let selectedMonth = body?.selectedMonth;

  if (runId && runId !== "stub-today") {
    const { data, error } = await supabase
      .from("workflow_runs")
      .select("id,business_date")
      .eq("id", runId)
      .single();
    if (!error && data) {
      effectiveDate = data.business_date;
      selectedMonth = selectedMonth || data.business_date?.slice(0, 7);
    }
  }

  if (!effectiveDate) {
    effectiveDate = body?.businessDate || new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    selectedMonth = selectedMonth || effectiveDate.slice(0, 7);
  }

  // 1. Clasificar pregunta y tiempo
  const qId = classifyQuestion(question);
  const dateRange = parseDateFromQuestion(question, selectedMonth);

  let deterministicResult: string | null = null;

  // 2. Calcular si la pregunta es reconocida
  if (qId !== null) {
    console.log(`[AI] Question classified as ID: ${qId}. Calculating deterministically...`);
    deterministicResult = await calculateDeterministicAnswer(qId, supabase, effectiveDate, dateRange);
  }

  // 3. Preparar prompt para el LLM
  const parts: string[] = [
    "Eres SantoBot, el experto analista financiero de Santo Restaurants. Le hablas a los socios.",
    "Reglas estrictas:",
    "1. Respondé EXCLUSIVAMENTE a la pregunta del usuario basándote en la información exacta proveída.",
    "2. Sé conciso y directo, sin rodeos.",
    "3. Si un dato falta explícalo, no inventes números.",
  ];

  if (deterministicResult) {
    parts.push(
      "",
      "━━━ RESULTADO CALCULADO DETERMINÍSTICAMENTE POR EL SISTEMA ━━━",
      "El sistema de backend ha procesado la base de datos SQL y ha calculado este resultado exacto para la pregunta del usuario:",
      deterministicResult,
      "Tu tarea es redactar una respuesta natural y clara usando EXCLUSIVAMENTE estos números. No hagas más cálculos."
    );
  } else {
    // Fallback: Proveer datos crudos para que el LLM calcule si es una pregunta no mapeada
    let rawMonthlyData: any = {};
    if (selectedMonth) {
      const { data: dailyRecords } = await supabase.from("corte_daily_records").select("*").gte("business_date", `${selectedMonth}-01`).lte("business_date", `${selectedMonth}-31`);
      const { data: receivables } = await supabase.from("corte_receivables").select("receivable_key, opened_on, principal, settled_on, settled_principal, status").or(`opened_on.gte.${selectedMonth}-01,settled_on.gte.${selectedMonth}-01`).lte("opened_on", `${selectedMonth}-31`);
      rawMonthlyData = { mes: selectedMonth, ventas_diarias_totales: dailyRecords, cuentas_por_cobrar: receivables };
    }
    parts.push(
      "",
      "━━━ DATOS CRUDOS ━━━",
      "El sistema no pudo calcular un resultado determinístico pre-programado. Aquí tienes la data cruda del mes para que deduzcas la respuesta.",
      JSON.stringify(rawMonthlyData)
    );
  }

  parts.push("", `PREGUNTA: ${question}`);

  const prompt = parts.join("\n");

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest", max_tokens: 400, temperature: 0.1,
          system: "Sos SantoBot, asistente financiero de Santo Restaurants.",
          messages: [{ role: "user", content: prompt }]
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const payload = await response.json();
        const answer = payload?.content?.map((block: { text?: string }) => block.text ?? "").join("").trim();
        if (answer) return NextResponse.json({ answer, mode: "llm_explained" });
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
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 400 } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!gResp.ok) return NextResponse.json({ error: "El asistente no pudo responder." }, { status: 502 });
    const gPayload = await gResp.json();
    const answer = gPayload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim();
    return NextResponse.json({ answer: answer || "No pude generar una respuesta.", mode: "llm_explained" });
  } catch (e) {
    console.error("Gemini API error:", e);
    return NextResponse.json({ error: "Timeout al contactar el asistente." }, { status: 504 });
  }
}
