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

  const parts = [
    "Sos un asistente financiero de Santo Restaurants. Ayudás a los socios y supervisores a entender los números del restaurante.",
    "Respondé en español, breve y claro. Mirá todos los datos disponibles antes de responder.",
    "No inventes cifras. Si te preguntan algo que no está en los datos, decí 'Ese dato no está disponible en este corte'.",
    "No apruebes pagos, bancos, fiscal, legal ni acciones externas. Solo explicá números y sugerí qué revisar.",
    "",
    `Pregunta del usuario: ${question}`,
    "",
    "=== DATOS DEL CORTE SELECCIONADO ===",
    `Fecha: ${run.business_date}`,
    `Estado: ${run.status}`,
    `Motivo de revisión: ${run.requires_review_reason || "Ninguno"}`,
    `Total venta real del día: $${ventaReal.toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN`,
    `Meta forecast del día: $${(forecastDia ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN`,
    forecastDia != null && forecastDia > 0 
      ? `Diferencia vs forecast: $${(ventaReal - forecastDia).toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN (${(((ventaReal - forecastDia) / forecastDia) * 100).toFixed(1)}%)`
      : "No hay forecast para comparar este día.",
    `Formato de corte: ${revision?.formato_corte || "No disponible"}`,
    "",
    "=== RECONCILIACIÓN ===",
    `Total Real: $${(revision?.reconciliation_totals?.total_real ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`,
    `Total Sistema: $${(revision?.reconciliation_totals?.total_sistema ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`,
    `Diferencia: $${(revision?.reconciliation_totals?.difference ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`,
    "",
    "=== INGRESOS POR CANAL ===",
    JSON.stringify(run.output_payload?.income_register ?? run.output_payload?.income_channels ?? {}, null, 2),
    "",
    "=== FALTA POR ENTRAR ===",
    JSON.stringify(revision?.falta_por_entrar ?? {}, null, 2),
    "",
    "=== GASTOS ADICIONALES ===",
    JSON.stringify(revision?.gastos_adicionales ?? [], null, 2),
    "",
    "=== AJUSTES DEL DÍA ===",
    JSON.stringify(revision?.ajustes_del_dia ?? [], null, 2),
  ];

  // Append week context if provided
  if (body.weekContext) {
    const wc = body.weekContext;
    parts.push(
      "",
      "=== CONTEXTO DE LA SEMANA ===",
      `Total vendido en la semana: $${wc.totalVendido.toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN`,
      `Meta de la semana: $${wc.totalMeta.toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN`,
      `Días con corte: ${wc.diasConCorte}`,
      "Días de la semana:",
      wc.cortes.map(c => `  ${c.fecha} → Venta: $${c.venta.toLocaleString("es-MX", { minimumFractionDigits: 2 })} | Meta: ${c.meta != null ? "$" + c.meta.toLocaleString("es-MX", { minimumFractionDigits: 2 }) : "Sin forecast"} | Estado: ${c.status}`).join("\n"),
    );
  }

  // Append month context if provided
  if (body.monthContext) {
    const mc = body.monthContext;
    parts.push(
      "",
      "=== CONTEXTO DEL MES ===",
      `Total vendido en el mes: $${mc.totalVendido.toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN`,
      `Meta del mes: $${mc.totalMeta.toLocaleString("es-MX", { minimumFractionDigits: 2 })} MXN`,
      `Progreso del mes: ${mc.progressPct.toFixed(1)}%`,
    );
  }

  if (body.unit) {
    parts.push("", `Unidad: ${body.unit}`);
  }

  parts.push(
    "",
    "Instrucción final: Si el usuario pregunta '¿cuánto se vendió hoy?' o similar, respondé con el total de venta real del día. Si pregunta por la semana, usá el contexto semanal. Si pregunta por el mes, usá el contexto mensual. Siempre mencioná las cifras exactas de los datos. No digas 'aproximadamente' a menos que el dato no esté disponible."
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
