import { NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/authz";
import { answerFinancialQuestion, financialFacts, resolveFinancialPeriod } from "@/lib/financial-questions";

type AiRequestBody = { question?: string; businessDate?: string; selectedMonth?: string };

export async function POST(request: Request) {
  const auth = await authorizeRequest(["supervisor", "socio"]);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });
  const body = await request.json().catch(() => null) as AiRequestBody | null;
  const question = body?.question?.trim();
  if (!question) return NextResponse.json({ error: "Falta la pregunta." }, { status: 400 });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const fallbackDate = body?.businessDate || today;
  const selectedMonth = body?.selectedMonth || fallbackDate.slice(0, 7);
  const period = resolveFinancialPeriod(question, selectedMonth, fallbackDate);
  const { supabase } = auth;

  const [dailyResult, receivableResult, workflowResult] = await Promise.all([
    supabase.from("corte_daily_records").select("*").gte("business_date", period.start).lte("business_date", period.end).order("business_date"),
    supabase.from("corte_receivables").select("receivable_key,opened_on,principal,settled_on,settled_principal,status,evidence").lte("opened_on", period.end).or(`settled_on.is.null,settled_on.gte.${period.start}`),
    supabase.from("workflows").select("id").eq("workflow_key", "corte_santo_daily_sales_reconciliation"),
  ]);
  if (dailyResult.error || receivableResult.error || workflowResult.error) {
    console.error("financial question data error", dailyResult.error || receivableResult.error || workflowResult.error);
    return NextResponse.json({ error: "No pude leer los datos financieros." }, { status: 502 });
  }
  const workflowIds = (workflowResult.data ?? []).map((workflow) => workflow.id);
  const runsResult = workflowIds.length
    ? await supabase.from("workflow_runs").select("business_date,created_at,output_payload").in("workflow_id", workflowIds).order("created_at", { ascending: false }).limit(300)
    : { data: [], error: null };
  if (runsResult.error) {
    console.error("financial question bank data error", runsResult.error);
    return NextResponse.json({ error: "No pude leer las conciliaciones bancarias." }, { status: 502 });
  }
  const bankRuns = (runsResult.data ?? []).filter((run) => Boolean((run.output_payload as Record<string, unknown>)?.bank_reconciliation));
  const financialData = {
    question, periodStart: period.start, periodEnd: period.end, effectiveDate: period.effectiveDate,
    dailyRecords: dailyResult.data ?? [], receivables: receivableResult.data ?? [], bankRuns,
    // A question about June refers to June sales, but its pending balance is
    // answered with the latest known bank state, not an obsolete June snapshot.
    latestBankRun: bankRuns[0] ?? null,
  };
  const answer = answerFinancialQuestion(financialData);
  if (answer) return NextResponse.json({ answer, mode: "financial_rules", period });
  const fallback = await answerWithAi(question, financialFacts(financialData));
  if (fallback) return NextResponse.json({ answer: fallback, mode: "ai_with_financial_facts", period });
  return NextResponse.json({ answer: "No tengo datos suficientes para responderlo con certeza.", mode: "requires_review", period });
}

async function answerWithAi(question: string, facts: unknown) {
  const prompt = [
    "Respondé como asistente financiero de Santo para socios de restaurantes.",
    "Entendé formulaciones equivalentes a ventas, depósitos, pendientes, CxC, propinas, efectivo, Uber, Rappi y comisiones.",
    "Usá solamente los datos provistos. No estimes, no completes meses incompletos y no confundas fecha de venta con fecha de depósito.",
    "Si la pregunta necesita un vínculo que no aparece en los datos, decilo de manera simple: 'Todavía no tengo esa conciliación cargada para confirmarlo'.",
    "Respondé breve, claro y con montos en formato $0.00. No menciones bases de datos, JSON, modelos ni detalles técnicos.",
    `DATOS FINANCIEROS VERIFICADOS: ${JSON.stringify(facts)}`,
    `PREGUNTA: ${question}`,
  ].join("\n\n");
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest", max_tokens: 350, temperature: 0, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const payload = await response.json();
        const answer = payload?.content?.map((block: { text?: string }) => block.text ?? "").join("").trim();
        if (answer) return answer;
      }
    } catch (error) { console.error("financial AI fallback error", error); }
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;
  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 350 } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim() || null;
  } catch (error) { console.error("financial AI fallback error", error); return null; }
}
