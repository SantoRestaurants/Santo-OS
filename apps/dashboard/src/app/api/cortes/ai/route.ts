import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/authz";

type AiRequestBody = {
  runId?: string;
  question?: string;
  unit?: string;
  businessDate?: string;
  weekContext?: {
    totalVendido: number;
    totalMeta: number;
    diasConCorte: number;
    cortes: Array<{ fecha: string; venta: number; meta: number | null; status: string }>;
  };
  monthContext?: { totalVendido: number; totalMeta: number; progressPct: number };
  selectedMonth?: string;
};

type CorteAiProviderPayload = {
  answer?: string;
  error?: string;
  mode?: string;
};

export async function POST(request: Request) {
  const auth = await authorizeRequest(["supervisor", "socio"]);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });
  const { supabase } = auth;

  const body = (await request.json().catch(() => null)) as AiRequestBody | null;
  const runId = body?.runId;
  const question = body?.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "Falta la pregunta." }, { status: 400 });
  }

  let run: any = null;
  let effectiveDate: string | null = null;
  let selectedMonth = body?.selectedMonth;

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

  if (!effectiveDate) {
    effectiveDate = body?.businessDate || new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    selectedMonth = selectedMonth || effectiveDate.slice(0, 7);
  }

  let contextRun = run;
  if (!run || !run.output_payload || Object.keys(run.output_payload).length === 0 || run?.status === "requires_review") {
    const { data: latestRun } = await supabase
      .from("workflow_runs")
      .select("id,business_date,status,source_channel,requires_review_reason,created_at,output_payload")
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
        selectedMonth = selectedMonth || latestRun.business_date?.slice(0, 7);
      }
    }
  }

  const rawMonthlyData = selectedMonth
    ? await buildMonthlyAiContext(supabase, selectedMonth, effectiveDate, body)
    : {};

  const prompt = buildPrompt({
    question,
    unit: body?.unit,
    effectiveDate,
    requestedDate: run?.business_date || body?.businessDate,
    contextRun,
    rawMonthlyData,
  });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const payload = await askClaude(prompt, anthropicKey);
    if (payload.answer) return NextResponse.json({ answer: payload.answer, mode: payload.mode });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return NextResponse.json({ error: "No hay un proveedor de IA aprobado y configurado." }, { status: 503 });

  const payload = await askGemini(prompt, geminiKey);
  if (payload.answer) return NextResponse.json({ answer: payload.answer, mode: payload.mode });

  return NextResponse.json({ error: payload.error || "El asistente no pudo responder." }, { status: 502 });
}

async function buildMonthlyAiContext(supabase: any, selectedMonth: string, effectiveDate: string | null, body: AiRequestBody | null) {
  try {
    const [dailyResult, receivablesResult, latestBankResult, absoluteLatestResult] = await Promise.all([
      supabase
        .from("corte_daily_records")
        .select("business_date,amex,debito,credito,efectivo,transferencia,total,paypal,uber_eats,rappi,propinas,venta_bruta,total_bruto,forecast_target")
        .gte("business_date", `${selectedMonth}-01`)
        .lte("business_date", `${selectedMonth}-31`)
        .order("business_date", { ascending: true }),
      supabase
        .from("corte_receivables")
        .select("receivable_key,opened_on,principal,settled_on,settled_principal,status,evidence,created_at,updated_at")
        .or(`opened_on.gte.${selectedMonth}-01,settled_on.gte.${selectedMonth}-01`)
        .lte("opened_on", `${selectedMonth}-31`)
        .order("opened_on", { ascending: true }),
      supabase
        .from("workflow_runs")
        .select("id,business_date,status,output_payload")
        .eq("source_channel", "agent_mail")
        .gte("business_date", `${selectedMonth}-01`)
        .lte("business_date", effectiveDate || `${selectedMonth}-31`)
        .order("business_date", { ascending: false })
        .limit(10),
      supabase
        .from("workflow_runs")
        .select("id,business_date,status,output_payload")
        .eq("source_channel", "agent_mail")
        .order("business_date", { ascending: false })
        .limit(1),
    ]);

    const latestBankRun = (latestBankResult.data ?? []).find((candidate: any) => candidate?.output_payload?.bank_reconciliation) ?? null;
    const bankReconciliation = latestBankRun?.output_payload?.bank_reconciliation ?? null;

    const absoluteLatestRun = (absoluteLatestResult.data ?? []).find((candidate: any) => candidate?.output_payload?.bank_reconciliation) ?? null;
    const absoluteBankReconciliation = absoluteLatestRun?.output_payload?.bank_reconciliation ?? null;

    return {
      mes: selectedMonth,
      ventas_diarias_totales: dailyResult.data ?? [],
      cuentas_por_cobrar: receivablesResult.data ?? [],
      contexto_semana_ui: body?.weekContext ?? null,
      estado_actual: {
        mes: selectedMonth,
        snapshot_bancario_del_dia_seleccionado: bankReconciliation ? {
            business_date: latestBankRun.business_date,
            status: latestBankRun.output_payload?.bank_validation_status ?? bankReconciliation.status,
            pending_collections: bankReconciliation.pending_collections ?? {},
            pending_items: bankReconciliation.pending_items ?? [],
            matches: bankReconciliation.matches ?? [],
            deposits_by_source: bankReconciliation.deposits_by_source ?? {},
            amex_matches: bankReconciliation.amex_matches ?? [],
            batch_validation: bankReconciliation.batch_validation ?? [],
          } : null,
        snapshot_bancario_actual_hoy: absoluteBankReconciliation ? {
            business_date: absoluteLatestRun.business_date,
            status: absoluteLatestRun.output_payload?.bank_validation_status ?? absoluteBankReconciliation.status,
            pending_collections: absoluteBankReconciliation.pending_collections ?? {},
            pending_items: absoluteBankReconciliation.pending_items ?? [],
          } : null,
      },
    };
  } catch (error) {
    console.error("Error fetching AI monthly context:", error);
    return { mes: selectedMonth, error: "monthly_context_unavailable" };
  }
}

function buildPrompt(input: {
  question: string;
  unit?: string;
  effectiveDate: string | null;
  requestedDate?: string | null;
  contextRun: any;
  rawMonthlyData: any;
}) {
  const parts: string[] = [
    "Sos SantoBot, el analista financiero de Santo Restaurants. Le hablás a socios y supervisores.",
    "Reglas estrictas:",
    "1. Respondé exclusivamente a la pregunta. No des reportes generales si no te los pidieron.",
    "2. Sé conciso y directo. Mostrá cifras exactas con formato $0.00.",
    "3. Para responder sobre 'falta entrar', dinero pendiente, o qué falta por depositarse AL DÍA DE HOY (en presente), usa SIEMPRE 'snapshot_bancario_actual_hoy.pending_collections' y 'snapshot_bancario_actual_hoy.pending_items'. Ese snapshot tiene la verdad absoluta de lo que sigue debiéndose HOY en el mundo real.",
    "   - Si preguntan cuánto de las ventas del día X sigue pendiente hoy, busca la fecha X en 'snapshot_bancario_actual_hoy.pending_items'. Si no está, es que ya se depositó.",
    "4. Para calcular depósitos ingresados al banco ESE DÍA, revisa 'snapshot_bancario_del_dia_seleccionado':",
    "   - Si preguntan por depósitos de BANORTE o depósitos de las terminales Banorte: Mira 'snapshot_bancario_del_dia_seleccionado.deposits_by_source.banorte' para ver el total físico que entró al banco ese día. NO sumes 'batch_validation'.",
    "   - Si preguntan por depósitos de AMERICAN EXPRESS: Suma los montos de 'deposit_amount' o 'amount' dentro de 'snapshot_bancario_del_dia_seleccionado.amex_matches'.",
    "   - Si preguntan 'cuánto falta entrar' (pendiente) de BANORTE hoy: Suma SOLO los valores de 'credito' y 'debito' dentro de 'snapshot_bancario_actual_hoy.pending_collections'. EXCLUYE estrictamente 'amex'.",
    "5. Para CxC, usá 'cuentas_por_cobrar'. Si un registro está settled, ya fue depositado/conciliado en settled_on.",
    "6. Nunca inventes cifras. Si tras calcular sigues sin datos suficientes, decí: 'No hay información registrada para ese cálculo'.",
    "",
    `Fecha efectiva de análisis: ${input.effectiveDate ?? "no disponible"}`,
  ];

  if (input.requestedDate && input.effectiveDate !== input.requestedDate) {
    parts.push(`Nota: la fecha pedida (${input.requestedDate}) no tenía datos completos; se usa el contexto disponible.`);
  }
  if (input.unit) parts.push(`Unidad: ${input.unit}`);

  parts.push(
    "",
    "━━━ DATOS ESTRUCTURADOS DISPONIBLES ━━━",
    JSON.stringify(input.rawMonthlyData),
    "",
    "━━━ RUN DE CONTEXTO ━━━",
    JSON.stringify({
      id: input.contextRun?.id,
      business_date: input.contextRun?.business_date,
      status: input.contextRun?.status,
      reconciliation_totals: input.contextRun?.output_payload?.reconciliation_totals,
      daily_financial_record: input.contextRun?.output_payload?.daily_financial_record,
    }),
    "",
    `PREGUNTA: ${input.question}`,
    "",
    "Respondé solo lo preguntado usando los datos provistos."
  );

  return parts.join("\n");
}

async function askClaude(prompt: string, anthropicKey: string): Promise<CorteAiProviderPayload> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest",
        max_tokens: 600,
        temperature: 0.0,
        system: "Sos SantoBot, asistente financiero de Santo Restaurants.",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { error: `claude_failed:${response.status}` };
    const payload = await response.json();
    const answer = payload?.content?.map((block: { text?: string }) => block.text ?? "").join("").trim();
    return { answer, mode: "llm:claude" };
  } catch (error) {
    console.error("Claude API error:", error);
    return { error: "claude_timeout_or_error" };
  }
}

async function askGemini(prompt: string, geminiKey: string): Promise<CorteAiProviderPayload> {
  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 600 },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { error: `gemini_failed:${response.status}` };
    const payload = await response.json();
    const answer = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim();
    return { answer: answer || "No pude generar una respuesta.", mode: "llm:gemini" };
  } catch (error) {
    console.error("Gemini API error:", error);
    return { error: "gemini_timeout_or_error" };
  }
}
