import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/authz";
import { dailyForecastMeta, dailySales, dedupeRunsByDay } from "@/lib/corte-dashboard-utils";
import { extractRevisionDocument } from "@/lib/corte-data";

type AiRequestBody = {
  runId?: string;
  question?: string;
  unit?: string;
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
  if (!runId || !question) {
    return NextResponse.json({ error: "Falta la pregunta o el corte." }, { status: 400 });
  }

  // Fetch selected run
  const { data: run, error } = await supabase
    .from("workflow_runs")
    .select("id,business_date,status,source_channel,requires_review_reason,created_at,output_payload")
    .eq("id", runId)
    .single();
  if (error || !run) return NextResponse.json({ error: "No encontré ese corte." }, { status: 404 });

  const revision = extractRevisionDocument({ ...run, business_date: run.business_date ?? "" });
  const ventaReal = dailySales({ ...run, revision });
  const forecastDia = dailyForecastMeta({ ...run, revision });
  const op = (run.output_payload ?? {}) as Record<string, unknown>;
  const bankRec = op.bank_reconciliation as Record<string, unknown> | undefined;
  const ingresos = op.income_register ?? op.income_channels;
  const fpe = revision?.falta_por_entrar as Record<string, number> | undefined;
  const saldos = op.saldos as Record<string, number> | undefined;

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

  const parts: string[] = [
    "Sos SantoBot, el asistente financiero de Santo Restaurants. Le hablás a los socios y al equipo de administración del restaurante.",
    "Reglas:",
    "- Respondé siempre en español, con oraciones cortas, directas y precisas.",
    "- Usá los DATOS DEL DÍA, DATOS DEL MES, BANCOS, SALDOS y COBROS PENDIENTES para responder.",
    "- Si los datos necesarios no están disponibles, decí exactamente: 'No tengo ese dato.'",
    "- Nunca inventes cifras. Solo respondé con lo que ves en los datos provistos.",
    "- No sugieras acciones fiscales, bancarias ni legales.",
    "- Para preguntas de porcentajes, calculá con precisión y mostrá el resultado.",
    "",
    "━━━ DATOS DEL DÍA ━━━",
    `Fecha: ${run.business_date || "No disponible"}`,
    `Estado: ${run.status || "No disponible"}`,
    `Venta real: ${fmt(safeVenta)}`,
    `Meta forecast: ${fmt(safeMeta)}`,
    diff != null ? `Diferencia vs forecast: ${fmt(diff)} (${pct(safeVenta, safeMeta)})` : "Sin forecast.",
    `Total Real (terminal): ${fmt(revision?.reconciliation_totals?.total_real)}`,
    `Total Sistema: ${fmt(revision?.reconciliation_totals?.total_sistema)}`,
    `Diferencia: ${fmt(revision?.reconciliation_totals?.difference)}`,
  ];

  // Income breakdown
  if (ingresos && typeof ingresos === "object" && Object.keys(ingresos as Record<string, unknown>).length > 0) {
    parts.push("", "Desglose de ingresos del día:", JSON.stringify(ingresos, null, 2));
  }

  // Bank reconciliation data
  if (bankRec) {
    const am = bankRec.amex_matches as Array<Record<string, unknown>> | undefined;
    const pi = bankRec.pending_items as Array<Record<string, unknown>> | undefined;
    const bv = bankRec.batch_validation as Array<Record<string, unknown>> | undefined;
    const mf = bankRec.missing_funds as Record<string, number> | undefined;

    parts.push("", "━━━ DATOS BANCARIOS ━━━");
    if (am?.length) parts.push(`Pagos AMEX matcheados: ${am.length}`, JSON.stringify(am.slice(0, 10), null, 2));
    if (pi?.length) parts.push(`Pagos pendientes: ${pi.length}`, JSON.stringify(pi.slice(0, 10), null, 2));
    if (bv?.length) parts.push(`Validación de batches Banorte: ${JSON.stringify(bv, null, 2)}`);
    if (mf) parts.push(`Fondos faltantes: ${JSON.stringify(mf)}`);
  }

  // Falta por entrar
  if (fpe && Object.keys(fpe).length > 0) {
    parts.push("", "━━━ FALTA POR ENTRAR EN LA CUENTA ━━━", JSON.stringify(fpe, null, 2));
  }

  // Saldos
  if (saldos && Object.values(saldos).some(v => v > 0)) {
    parts.push("", "━━━ SALDOS ━━━", JSON.stringify(saldos, null, 2));
  }

  // Full month data
  const selectedMonth = body.selectedMonth || run.business_date?.slice(0, 7);
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
          // Build plain objects for dedup
          const plainRuns = monthRuns.map(r => ({
            id: r.id, business_date: r.business_date, status: r.status,
            source_channel: (r as any).source_channel || "agent_mail",
            requires_review_reason: (r as any).requires_review_reason || null,
            created_at: (r as any).created_at || "",
            output_payload: r.output_payload,
            revision: extractRevisionDocument({ ...r, business_date: r.business_date ?? "", source_channel: (r as any).source_channel || "agent_mail", requires_review_reason: (r as any).requires_review_reason || null, created_at: (r as any).created_at || "" } as any) ?? undefined,
            documents: [] as any[], reviews: [] as any[], exceptions: [] as any[], email: null,
          }));
          const deduped = (dedupeRunsByDay as any)(plainRuns);

          const monthSummary = (deduped as any[]).map((run: any) => {
            const rop: any = run.output_payload ?? {};
            const rir = rop.income_register as Record<string, number> | undefined;
            const rrev = run.revision as any;
            return {
              fecha: run.business_date,
              status: run.status,
              venta_real: dailySales(run as any) ?? 0,
              total_real: rrev?.reconciliation_totals?.total_real ?? 0,
              amex: rir?.amex ?? 0,
              debito: rir?.debito ?? 0,
              credito: rir?.credito ?? 0,
              efectivo: rir?.efectivo ?? 0,
              paypal: rir?.paypal ?? 0,
              uber: rir?.uber ?? 0,
              rappi: rir?.rappi ?? 0,
              propinas: rir?.propinas ?? 0,
              plataformas: rir?.plataformas ?? 0,
              bancos: rir?.bancos ?? 0,
              bank_validated: rop.bank_validation_status === "bank_validated",
              falta_por_entrar: rrev?.falta_por_entrar ?? {},
              saldos: rop.saldos ?? {},
            };
          });

          // Monthly totals
          const totals = {
            amex: monthSummary.reduce((s, d) => s + d.amex, 0),
            debito: monthSummary.reduce((s, d) => s + d.debito, 0),
            credito: monthSummary.reduce((s, d) => s + d.credito, 0),
            efectivo: monthSummary.reduce((s, d) => s + d.efectivo, 0),
            uber: monthSummary.reduce((s, d) => s + d.uber, 0),
            rappi: monthSummary.reduce((s, d) => s + d.rappi, 0),
            propinas: monthSummary.reduce((s, d) => s + d.propinas, 0),
            venta_real: monthSummary.reduce((s, d) => s + d.venta_real, 0),
            total_real: monthSummary.reduce((s, d) => s + d.total_real, 0),
            bancos: monthSummary.reduce((s, d) => s + d.bancos, 0),
            plataformas: monthSummary.reduce((s, d) => s + d.plataformas, 0),
          };

          const validatedCount = monthSummary.filter(d => d.bank_validated).length;
          const pendingCount = monthSummary.length - validatedCount;

          parts.push(
            "",
            "━━━ RESUMEN DEL MES ━━━",
            `Días con corte: ${monthSummary.length} | Validados con banco: ${validatedCount} | Pendientes: ${pendingCount}`,
            "",
            "Totales mensuales:",
            JSON.stringify(totals, null, 2),
            "",
            "Detalle diario:",
            JSON.stringify(monthSummary, null, 2),
          );
        }
      }
    } catch { /* ignore month fetch errors */ }
  }

  // Week/month context
  if (body.weekContext && body.weekContext.totalVendido > 0) {
    const wc = body.weekContext;
    parts.push("", "━━━ CONTEXTO DE LA SEMANA ━━━", `Total: ${fmt(wc.totalVendido)} | Meta: ${fmt(wc.totalMeta)} | Días: ${wc.diasConCorte}`);
  }
  if (body.monthContext && body.monthContext.totalMeta > 0) {
    const mc = body.monthContext;
    parts.push("", "━━━ CONTEXTO DEL MES ━━━", `Total: ${fmt(mc.totalVendido)} | Meta mensual: ${fmt(mc.totalMeta)} | Progreso: ${mc.progressPct.toFixed(1)}%`);
  }
  if (body.unit) parts.push("", `Unidad: ${body.unit}`);

  parts.push("", `PREGUNTA: ${question}`, "", "Respondé solo lo que te preguntaron con los datos provistos. Sé preciso con cifras y porcentajes.");

  const prompt = parts.join("\n");

  // Try Claude first
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest", max_tokens: 800, temperature: 0.2,
          system: "Sos SantoBot, asistente financiero de Santo Restaurants.",
          messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const payload = await response.json();
        const answer = payload?.content?.map((block: { text?: string }) => block.text ?? "").join("").trim();
        if (answer) return NextResponse.json({ answer });
      }
    } catch (e) {
      console.error("Claude API error:", e);
    }
  }

  // Gemini remains the only configured fallback used by the existing Corte
  // vision pipeline. Additional providers require an explicit governance decision.
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return NextResponse.json({ error: "No hay un proveedor de IA aprobado y configurado." }, { status: 503 });
  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const gResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 800 } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!gResp.ok) return NextResponse.json({ error: "El asistente no pudo responder." }, { status: 502 });
    const gPayload = await gResp.json();
    const answer = gPayload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("").trim();
    return NextResponse.json({ answer: answer || "No pude generar una respuesta." });
  } catch (e) {
    console.error("Gemini API error:", e);
    return NextResponse.json({ error: "Timeout al contactar el asistente." }, { status: 504 });
  }
}
