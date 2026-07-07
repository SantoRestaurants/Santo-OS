import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/authz";
import { dailyForecastMeta, dailySales } from "@/lib/corte-dashboard-utils";
import { extractRevisionDocument } from "@/lib/corte-data";

type AiRequestBody = {
  runId?: string;
  question?: string;
  unit?: string;
  businessDate?: string;
  weekContext?: { totalVendido: number; totalMeta: number; diasConCorte: number; cortes: Array<{ fecha: string; venta: number; meta: number | null; status: string }> };
  monthContext?: { totalVendido: number; totalMeta: number; progressPct: number };
  selectedMonth?: string;
};

function normalizeQuestion(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function money(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
}

async function answerDirectQuestion(
  question: string,
  supabase: any,
  businessDate: string,
  selectedMonth: string,
): Promise<string | null> {
  const q = normalizeQuestion(question);

  if ((q.includes("forecast") || q.includes("meta")) && (q.includes("hoy") || q.includes("dia"))) {
    const { data: daily } = await supabase
      .from("corte_daily_records")
      .select("forecast_target")
      .eq("business_date", businessDate)
      .limit(1)
      .maybeSingle();
    let target = typeof daily?.forecast_target === "number" ? daily.forecast_target : null;
    if (target == null) {
      const { data: runs } = await supabase
        .from("workflow_runs")
        .select("output_payload")
        .eq("workflow_key", "corte_santo_daily_sales_reconciliation")
        .eq("source_channel", "agent_mail")
        .gte("business_date", `${selectedMonth}-01`)
        .lte("business_date", `${selectedMonth}-31`)
        .order("business_date", { ascending: false })
        .limit(20);
      for (const candidate of runs ?? []) {
        const rows = candidate.output_payload?.revision_document?.vta_por_dia;
        const row = Array.isArray(rows)
          ? rows.find((item: { fecha?: string }) => item.fecha === businessDate)
          : null;
        if (typeof row?.meta_vta === "number") {
          target = row.meta_vta;
          break;
        }
      }
    }
    if (target == null) {
      const { data: documents } = await supabase
        .from("documents")
        .select("metadata")
        .eq("document_type", "forecast_workbook")
        .order("created_at", { ascending: false })
        .limit(20);
      for (const document of documents ?? []) {
        if (document.metadata?.month !== selectedMonth) continue;
        const row = Array.isArray(document.metadata?.vta_por_dia)
          ? document.metadata.vta_por_dia.find((item: { fecha?: string }) => item.fecha === businessDate)
          : null;
        if (typeof row?.meta_vta === "number") {
          target = row.meta_vta;
          break;
        }
      }
    }
    return target == null
      ? `No hay una meta de forecast registrada para el ${businessDate}.`
      : `La meta de forecast del ${businessDate} es ${money(target)}.`;
  }

  if (q.includes("falta") && (q.includes("entrar") || q.includes("deposit"))) {
    const { data: runs } = await supabase
      .from("workflow_runs")
      .select("business_date,created_at,output_payload")
      .eq("workflow_key", "corte_santo_daily_sales_reconciliation")
      .eq("source_channel", "agent_mail")
      .lte("business_date", businessDate)
      .order("business_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    for (const candidate of runs ?? []) {
      const output = candidate.output_payload ?? {};
      const bank = output.bank_reconciliation ?? output.bank_stage?.bank_reconciliation;
      const revision = output.revision_document;
      const hasBankSnapshot = bank && Object.prototype.hasOwnProperty.call(bank, "pending_collections");
      const hasRevisionSnapshot = revision && Object.prototype.hasOwnProperty.call(revision, "falta_por_entrar");
      if (!hasBankSnapshot && !hasRevisionSnapshot) continue;
      const pending = (hasBankSnapshot ? bank.pending_collections : revision.falta_por_entrar) ?? {};
      const entries = Object.entries(pending)
        .map(([channel, amount]) => [channel, Number(amount)] as const)
        .filter(([, amount]) => Number.isFinite(amount) && amount > 0);
      const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
      if (total === 0) return `No hay importes pendientes por entrar, conciliado hasta ${candidate.business_date}.`;
      const detail = entries.map(([channel, amount]) => `${channel}: ${money(amount)}`).join("; ");
      return `Falta por entrar ${money(total)}, conciliado hasta ${candidate.business_date}. ${detail}.`;
    }
    return "Todavía no hay una conciliación bancaria disponible para calcular lo pendiente.";
  }

  const monthlyField = q.includes("uber") ? "uber_eats"
    : q.includes("rappi") ? "rappi"
      : q.includes("propina") ? "propinas"
        : q.includes("efectivo") ? "efectivo"
          : q.includes("amex") || q.includes("american express") ? "amex"
            : null;
  const asksMonthlyTotal = q.includes("mes") || q.includes("julio") || q.includes("junio") || q.includes("total");
  if (monthlyField && asksMonthlyTotal && (q.includes("venta") || q.includes("recaud") || q.includes("monto"))) {
    const { data: records } = await supabase
      .from("corte_daily_records")
      .select(`${monthlyField},venta_bruta`)
      .gte("business_date", `${selectedMonth}-01`)
      .lte("business_date", `${selectedMonth}-31`);
    if (!records?.length) return `No hay cortes registrados para ${selectedMonth}.`;
    const total = records.reduce((sum: number, row: Record<string, number | null>) => sum + Number(row[monthlyField] ?? 0), 0);
    return `El total de ${monthlyField.replace("uber_eats", "Uber")} en ${selectedMonth} es ${money(total)}.`;
  }

  if (q.includes("venta") && (q.includes("hoy") || q.includes("dia"))) {
    const { data: daily } = await supabase
      .from("corte_daily_records")
      .select("venta_bruta")
      .eq("business_date", businessDate)
      .limit(1)
      .maybeSingle();
    return typeof daily?.venta_bruta === "number"
      ? `La Venta Bruta del ${businessDate} es ${money(daily.venta_bruta)}.`
      : `El corte del ${businessDate} todavía no tiene venta real cargada.`;
  }

  return null;
}

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

  const directAnswer = await answerDirectQuestion(
    question,
    supabase,
    effectiveDate,
    selectedMonth || effectiveDate.slice(0, 7),
  );
  if (directAnswer) {
    return NextResponse.json({ answer: directAnswer, mode: "direct" });
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
  const revision = contextRun ? extractRevisionDocument({ ...contextRun, business_date: contextRun.business_date ?? "" }) : null;
  const ventaReal = contextRun ? dailySales({ ...contextRun, revision }) : 0;
  const forecastDia = contextRun ? dailyForecastMeta({ ...contextRun, revision }) : null;
  const op = (contextRun?.output_payload ?? {}) as Record<string, unknown>;
  const ingresos = op.income_register ?? op.income_channels;
  const fpe = revision?.falta_por_entrar as Record<string, number> | undefined;

  function fmt(n: number | null | undefined) {
    if (n == null || Number.isNaN(n)) return "$0.00";
    return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(a: number, b: number | null) {
    if (!b || Number.isNaN(a) || Number.isNaN(b)) return "N/A";
    return ((a - b) / b * 100).toFixed(1) + "%";
  }

  const safeVenta = ventaReal ?? 0;
  const safeMeta = forecastDia ?? 0;
  const diff = safeMeta > 0 ? safeVenta - safeMeta : null;

  const parts: string[] = [
    "Sos SantoBot, el asistente financiero de Santo Restaurants. Le hablás a los socios y al equipo de administración del restaurante.",
    "Reglas:",
    "- Respondé siempre en español, con oraciones cortas, directas y precisas.",
    "- Usá los datos provistos para responder.",
    "- Si los datos necesarios no están disponibles, decí exactamente: 'No tengo ese dato.'",
    "- Nunca inventes cifras. Solo respondé con lo que ves en los datos provistos.",
    "- No sugieras acciones fiscales, bancarias ni legales.",
    "",
  ];

  // Notify if using data from a different date
  if (effectiveDate !== (run?.business_date || body?.businessDate)) {
    parts.push(
      `NOTA IMPORTANTE: El día seleccionado no tiene datos completos.`,
      `Estoy usando los datos más recientes disponibles del día ${effectiveDate}.`,
      ""
    );
  }

  parts.push(
    "━━━ DATOS DEL DÍA ━━━",
    `Fecha: ${effectiveDate || "No disponible"}`,
    `Estado: ${contextRun?.status || "No disponible"}`,
    `Venta real: ${fmt(ventaReal)}`,
    `Meta forecast: ${fmt(forecastDia)}`,
    diff != null ? `Diferencia vs forecast: ${fmt(diff)} (${pct(ventaReal, forecastDia)})` : "Sin forecast.",
  );

  // Income breakdown - keep compact
  if (ingresos && typeof ingresos === "object" && Object.keys(ingresos as Record<string, unknown>).length > 0) {
    const ir = ingresos as Record<string, number>;
    parts.push("", "Ingresos del día:");
    if (ir.amex) parts.push(`AMEX: ${fmt(ir.amex)}`);
    if (ir.debito) parts.push(`Débito: ${fmt(ir.debito)}`);
    if (ir.credito) parts.push(`Crédito: ${fmt(ir.credito)}`);
    if (ir.efectivo) parts.push(`Efectivo: ${fmt(ir.efectivo)}`);
    if (ir.propinas) parts.push(`Propinas: ${fmt(ir.propinas)}`);
  }

  // Falta por entrar - keep compact
  if (fpe && Object.keys(fpe).length > 0) {
    parts.push("", "━━━ FALTA POR ENTRAR ━━━");
    Object.entries(fpe).forEach(([ch, amt]) => {
      if (amt > 0) parts.push(`${ch}: ${fmt(amt)}`);
    });
  }

  // Full month data - keep compact, don't send entire JSON dumps
  if (selectedMonth) {
    try {
      const { data: wf } = await supabase.from("workflows").select("id").eq("workflow_key", "corte_santo_daily_sales_reconciliation").limit(1).single();
      if (wf) {
        const { data: monthRuns } = await supabase
          .from("workflow_runs")
          .select("id,business_date,status,output_payload")
          .eq("workflow_id", wf.id)
          .gte("business_date", `${selectedMonth}-01`)
          .lte("business_date", `${selectedMonth}-31`)
          .eq("source_channel", "agent_mail")
          .order("business_date", { ascending: true })
          .limit(50);

        if (monthRuns?.length) {
          const monthSummary = monthRuns.map((r: any) => {
            const rop = r.output_payload ?? {};
            const rir = rop.income_register as Record<string, number> | undefined;
            const daily = rop.daily_record as Record<string, number> | undefined;
            return {
              fecha: r.business_date,
              venta: Number(daily?.venta_bruta || 0),
              amex: Number(rir?.amex || daily?.amex || 0),
              efectivo: Number(rir?.efectivo || daily?.efectivo || 0),
              propinas: Number(rir?.propinas || daily?.propinas || 0),
            };
          });

          const totals = {
            venta_total: monthSummary.reduce((s: number, d: any) => s + d.venta, 0),
            amex_total: monthSummary.reduce((s: number, d: any) => s + d.amex, 0),
            efectivo_total: monthSummary.reduce((s: number, d: any) => s + d.efectivo, 0),
            propinas_total: monthSummary.reduce((s: number, d: any) => s + d.propinas, 0),
          };

          parts.push(
            "",
            "━━━ RESUMEN DEL MES ━━━",
            `Días con corte: ${monthSummary.length}`,
            `Venta total: ${fmt(totals.venta_total)}`,
            `AMEX total: ${fmt(totals.amex_total)}`,
            `Efectivo total: ${fmt(totals.efectivo_total)}`,
            `Propinas total: ${fmt(totals.propinas_total)}`,
          );
        }
      }
    } catch { /* ignore month fetch errors */ }
  }

  // Week/month context - keep compact
  if (body?.weekContext && body.weekContext.totalVendido > 0) {
    const wc = body.weekContext;
    parts.push("", `Semana: ${fmt(wc.totalVendido)} vendido, ${fmt(wc.totalMeta)} meta, ${wc.diasConCorte} días`);
  }
  if (body?.monthContext && body.monthContext.totalMeta > 0) {
    const mc = body.monthContext;
    parts.push("", `Mes: ${fmt(mc.totalVendido)} vendido, ${fmt(mc.totalMeta)} meta, ${mc.progressPct.toFixed(1)}% progreso`);
  }
  if (body?.unit) parts.push("", `Unidad: ${body.unit}`);

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
