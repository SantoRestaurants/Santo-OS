import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dailyForecastMeta, dailySales } from "@/lib/corte-dashboard-utils";
import { extractRevisionDocument } from "@/lib/corte-data";

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Falta configurar GEMINI_API_KEY." }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { runId?: string; question?: string } | null;
  const runId = body?.runId;
  const question = body?.question?.trim();
  if (!runId || !question) {
    return NextResponse.json({ error: "Falta la pregunta o el corte." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Falta configurar Supabase." }, { status: 503 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Tenés que iniciar sesión." }, { status: 401 });
  }

  const { data: run, error } = await supabase
    .from("workflow_runs")
    .select("id,business_date,status,source_channel,requires_review_reason,created_at,output_payload")
    .eq("id", runId)
    .single();

  if (error || !run) {
    return NextResponse.json({ error: "No encontré ese corte." }, { status: 404 });
  }

  const revision = extractRevisionDocument({ ...run, business_date: run.business_date ?? "" });
  const prompt = [
    "Sos un asistente interno de Santo Restaurants para una supervisora de cortes.",
    "Respondé en español, breve y claro. No inventes datos. Si falta información, decilo.",
    "No apruebes pagos, bancos, fiscal, legal ni acciones externas. Solo explicá el corte y sugerí qué revisar.",
    "",
    `Pregunta: ${question}`,
    "",
    "Datos del corte:",
    JSON.stringify({
      business_date: run.business_date,
      status: run.status,
      requires_review_reason: run.requires_review_reason,
      venta_real_dia: dailySales({ ...run, revision }),
      forecast_dia: dailyForecastMeta({ ...run, revision }),
      formato_corte: revision?.formato_corte,
      reconciliation_totals: revision?.reconciliation_totals,
      ingresos: run.output_payload?.income_register ?? run.output_payload?.income_channels,
      falta_por_entrar: revision?.falta_por_entrar,
      gastos_adicionales: revision?.gastos_adicionales,
      ajustes_del_dia: revision?.ajustes_del_dia,
    }, null, 2),
  ].join("\n");

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Gemini no pudo responder ahora." }, { status: 502 });
  }

  const payload = await response.json();
  const answer = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim();
  return NextResponse.json({ answer: answer || "No pude generar una respuesta con los datos disponibles." });
}
