import { NextResponse } from "next/server";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { dailyForecastMeta, dailySales } from "@/lib/corte-dashboard-utils";
import { extractRevisionDocument } from "@/lib/corte-data";

type WeekContext = {
  totalVendido: number;
  totalMeta: number;
  diasConCorte: number;
  cortes: Array<{ fecha: string; venta: number; meta: number | null; status: string }>;
};

type MonthContext = {
  totalVendido: number;
  totalMeta: number;
  progressPct: number;
};

type AiRequestBody = {
  runId?: string;
  question?: string;
  unit?: string;
  weekContext?: WeekContext;
  monthContext?: MonthContext;
};

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Falta configurar GEMINI_API_KEY." }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as AiRequestBody | null;
  const runId = body?.runId;
  const question = body?.question?.trim();
  if (!runId || !question) {
    return NextResponse.json({ error: "Falta la pregunta o el corte." }, { status: 400 });
  }

  // Try authenticated client first, fall back to service client (for socios public view)
  let supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      supabase = createSupabaseServiceClient();
    }
  } else {
    supabase = createSupabaseServiceClient();
  }

  if (!supabase) {
    return NextResponse.json({ error: "Falta configurar Supabase." }, { status: 503 });
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
  
  const ventaReal = dailySales({ ...run, revision });
  const forecastDia = dailyForecastMeta({ ...run, revision });

  function fmt(n: number | null | undefined) {
    if (n == null || Number.isNaN(n)) return "$0.00";
    return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pct(a: number, b: number) {
    if (!b || Number.isNaN(a) || Number.isNaN(b)) return "N/A";
    return ((a - b) / b * 100).toFixed(1) + "%";
  }

  const safeVenta = ventaReal ?? 0;
  const safeMeta = forecastDia ?? 0;
  const diff = safeMeta > 0 ? safeVenta - safeMeta : null;

  const parts = [
    "Sos SantoBot, el asistente financiero de Santo Restaurants. Le hablás a los socios del restaurante.",
    "Reglas:",
    "- Respondé siempre en español, con oraciones cortas y directas.",
    "- Siempre mirá primero los DATOS DEL DÍA. Ahí está la respuesta a preguntas sobre ventas, forecast y estado del corte.",
    "- Si te preguntan 'cuánto se vendió', respondé con la cifra exacta de 'Total venta real del día'.",
    "- Si los datos necesarios no están (dice 'No disponible' o '$0.00'), decí: 'No tengo ese dato para este día.'",
    "- Nunca inventes cifras ni interpretaciones. Solo respondé con lo que ves en los datos.",
    "- No sugieras acciones fiscales, bancarias ni legales.",
    "",
    "━━━ DATOS DEL DÍA ━━━",
    `Fecha: ${run.business_date || "No disponible"}`,
    `Estado del corte: ${run.status || "No disponible"}`,
    `Total venta real del día: ${fmt(safeVenta)} MXN`,
    `Meta forecast del día: ${fmt(safeMeta)} MXN`,
    diff != null
      ? `Diferencia vs forecast: ${fmt(diff)} MXN (${pct(safeVenta, safeMeta)})`
      : "No hay forecast para comparar este día.",
    `Total Real (cierre terminal): ${fmt(revision?.reconciliation_totals?.total_real)} MXN`,
    `Total Sistema: ${fmt(revision?.reconciliation_totals?.total_sistema)} MXN`,
    `Diferencia sistema vs real: ${fmt(revision?.reconciliation_totals?.difference)} MXN`,
  ];

  // Only include income breakdown if there's actual data
  const ingresos = run.output_payload?.income_register ?? run.output_payload?.income_channels;
  if (ingresos && typeof ingresos === "object" && Object.keys(ingresos as Record<string, unknown>).length > 0) {
    parts.push(
      "",
      "Desglose de ingresos:",
      JSON.stringify(ingresos, null, 2),
    );
  }

  // Only append week/month context if provided AND has meaningful data
  if (body.weekContext && body.weekContext.totalVendido > 0) {
    const wc = body.weekContext;
    parts.push(
      "",
      "━━━ CONTEXTO DE LA SEMANA ━━━",
      `Total semana: ${fmt(wc.totalVendido)} MXN | Meta: ${fmt(wc.totalMeta)} MXN | Días: ${wc.diasConCorte}`,
    );
  }

  if (body.monthContext && body.monthContext.totalMeta > 0) {
    const mc = body.monthContext;
    parts.push(
      "",
      "━━━ CONTEXTO DEL MES ━━━",
      `Total mes: ${fmt(mc.totalVendido)} MXN | Meta mensual: ${fmt(mc.totalMeta)} MXN | Progreso: ${mc.progressPct.toFixed(1)}%`,
    );
  }

  if (body.unit) {
    parts.push("", `Unidad: ${body.unit}`);
  }

  parts.push(
    "",
    `PREGUNTA DEL USUARIO: ${question}`,
    "",
    "Respondé solo lo que te preguntaron. Si la pregunta es sobre ventas del día, respondé con esa cifra. Si es sobre la semana, usá el contexto semanal. No des información que no te pidieron.",
  );

  const prompt = parts.join("\n");

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Gemini no pudo responder ahora." }, { status: 502 });
  }

  const payload = await response.json();
  const answer = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim();
  return NextResponse.json({ answer: answer || "No pude generar una respuesta con los datos disponibles." });
}
