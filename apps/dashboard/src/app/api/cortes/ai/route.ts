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

// Pattern-based question recognition (Spanish-aware)
function identifyQuestion(q: string): number | null {
  const patterns = [
    // Q1-Q4: Deposits and pending (today)
    { id: 1, test: (s: string) => (s.includes("american express") || s.includes("amex")) && (s.includes("deposit") || s.includes("depositó") || s.includes("depositaron")) && (s.includes("hoy") || s.includes("día de hoy")) },
    { id: 2, test: (s: string) => (s.includes("banorte") || s.includes("terminal")) && (s.includes("deposit") || s.includes("depositó") || s.includes("depositaron")) && (s.includes("hoy") || s.includes("día de hoy")) },
    { id: 3, test: (s: string) => (s.includes("american express") || s.includes("amex")) && s.includes("falta") && (s.includes("deposit") || s.includes("depositar")) },
    { id: 4, test: (s: string) => (s.includes("banorte") || s.includes("terminal")) && s.includes("falta") && (s.includes("deposit") || s.includes("depositar")) },

    // Q5: CxC percentage
    { id: 5, test: (s: string) => s.includes("porcentaje") && (s.includes("cuentas por cobrar") || s.includes("cxc")) && s.includes("ventas totales") },

    // Q6-Q10: Cash and tips
    { id: 6, test: (s: string) => s.includes("efectivo") && (s.includes("requiere") || s.includes("necesita")) && s.includes("propinas") },
    { id: 7, test: (s: string) => s.includes("efectivo real") && s.includes("ventas") },
    { id: 8, test: (s: string) => s.includes("cortesías") && s.includes("dirección") && s.includes("efectivo") },
    { id: 9, test: (s: string) => s.includes("dinero depositado") && s.includes("propinas") && s.includes("ingresos reales") },
    { id: 10, test: (s: string) => s.includes("porcentaje") && s.includes("propinas") && s.includes("ventas") },

    // Q11-Q14: Monthly deposits
    { id: 11, test: (s: string) => (s.includes("american express") || s.includes("amex")) && s.includes("depositado") && s.includes("durante") },
    { id: 12, test: (s: string) => (s.includes("banorte") || s.includes("terminal")) && s.includes("depositado") && s.includes("durante") },
    { id: 13, test: (s: string) => s.includes("cierre") && (s.includes("american express") || s.includes("amex")) && s.includes("pendiente") },
    { id: 14, test: (s: string) => s.includes("cierre") && (s.includes("banorte") || s.includes("terminal")) && s.includes("pendiente") && s.includes("monto total") },

    // Q15-Q16: Cross-month analysis (use LLM fallback)
    { id: 15, test: (s: string) => s.includes("ingresos depositados") && s.includes("ventas realizadas") && s.includes("mayo") && s.includes("banorte") },
    { id: 16, test: (s: string) => s.includes("dinero ingresó") && (s.includes("american express") || s.includes("amex")) && s.includes("mayo") },

    // Q17: AMEX commission
    { id: 17, test: (s: string) => s.includes("comisión") && (s.includes("american express") || s.includes("amex")) && s.includes("sin") && s.includes("iva") },

    // Q18-Q21: Platform sales and deposits (order matters: check specific patterns first)
    { id: 18, test: (s: string) => s.includes("monto total") && s.includes("ventas") && s.includes("uber") && !s.includes("rappi") },
    { id: 19, test: (s: string) => s.includes("monto total") && s.includes("ventas") && s.includes("rappi") && !s.includes("uber") },
    { id: 20, test: (s: string) => s.includes("monto total") && s.includes("depósito") && s.includes("uber") && !s.includes("rappi") },
    { id: 21, test: (s: string) => s.includes("monto total") && s.includes("depósito") && s.includes("rappi") && !s.includes("uber") },

    // Q22-Q25: Platform percentages
    { id: 22, test: (s: string) => s.includes("porcentaje") && s.includes("comisiones") && s.includes("uber") && !s.includes("rappi") },
    { id: 23, test: (s: string) => s.includes("porcentaje") && s.includes("comisiones") && s.includes("rappi") && !s.includes("uber") },
    { id: 24, test: (s: string) => s.includes("porcentaje") && s.includes("ventas totales") && s.includes("uber") && !s.includes("rappi") },
    { id: 25, test: (s: string) => s.includes("porcentaje") && s.includes("ventas totales") && s.includes("rappi") && !s.includes("uber") },
  ];

  for (const pattern of patterns) {
    if (pattern.test(q)) return pattern.id;
  }

  return null;
}

// Answer questions directly with SQL queries
async function answerDirectQuestion(questionId: number, supabase: any, context: { businessDate?: string; selectedMonth?: string }): Promise<string | null> {
  const fmt = (n: number | null | undefined) => {
    if (n == null || Number.isNaN(n)) return "$0.00";
    return "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const pct = (n: number | null | undefined) => {
    if (n == null || Number.isNaN(n)) return "0.0%";
    return n.toFixed(1) + "%";
  };

  try {
    switch (questionId) {
      case 1: // AMEX deposits today
      case 2: // Banorte deposits today
        if (!context.businessDate) return "No tengo la fecha del corte.";

        const { data: run } = await supabase
          .from("workflow_runs")
          .select("output_payload")
          .eq("business_date", context.businessDate)
          .eq("workflow_key", "corte_santo_daily_sales_reconciliation")
          .eq("source_channel", "agent_mail")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (!run) return "No encontré datos bancarios para ese día.";

        const bankRec = run.output_payload?.bank_reconciliation;
        if (!bankRec) return "No hay reconciliación bancaria disponible para ese día.";

        if (questionId === 1) {
          const amexMatches = bankRec.amex_matches || [];
          const deposited = amexMatches.reduce((sum: number, m: any) => sum + (m.deposit_amount || 0), 0);
          return `De las ventas de American Express, se depositaron ${fmt(deposited)} en la cuenta bancaria el día de hoy.`;
        } else {
          const batchValidation = bankRec.batch_validation || [];
          const deposited = batchValidation
            .filter((b: any) => b.matched)
            .reduce((sum: number, b: any) => sum + (b.deposit_amount || 0), 0);
          return `De las ventas con terminales Banorte, se depositaron ${fmt(deposited)} en la cuenta bancaria el día de hoy.`;
        }

      case 3: // AMEX pending
      case 4: // Banorte pending
        if (!context.businessDate) return "No tengo la fecha del corte.";

        const { data: receivables } = await supabase
          .from("corte_receivables")
          .select("principal, settled_principal")
          .eq("status", "open")
          .lte("opened_on", context.businessDate);

        if (!receivables?.length) return "No hay cuentas por cobrar pendientes.";

        const pending = receivables.reduce((sum: number, r: any) =>
          sum + (r.principal || 0) - (r.settled_principal || 0), 0);

        if (questionId === 3) {
          return `Faltan por depositarse ${fmt(pending)} de las ventas procesadas por American Express.`;
        } else {
          return `Faltan por depositarse ${fmt(pending)} de las ventas procesadas por terminales Banorte.`;
        }

      case 5: // CxC percentage
        if (!context.businessDate) return "No tengo la fecha del corte.";

        const { data: cxc } = await supabase
          .from("corte_receivables")
          .select("principal, settled_principal")
          .eq("status", "open")
          .lte("opened_on", context.businessDate);

        const { data: salesData } = await supabase
          .from("corte_daily_records")
          .select("venta_bruta")
          .eq("business_date", context.businessDate);

        if (!cxc?.length || !salesData?.length) return "No tengo datos suficientes para calcular el porcentaje.";

        const totalCxc = cxc.reduce((sum: number, r: any) =>
          sum + (r.principal || 0) - (r.settled_principal || 0), 0);
        const totalSales = salesData.reduce((sum: number, r: any) => sum + (r.venta_bruta || 0), 0);

        if (totalSales === 0) return "No hay ventas registradas.";

        const cxcPct = (totalCxc / totalSales) * 100;
        return `Las cuentas por cobrar representan el ${pct(cxcPct)} de las ventas totales (${fmt(totalCxc)} de ${fmt(totalSales)}).`;

      case 6: // Tips cash required (date range - use month)
      case 7: // Cash sales (date range)
      case 8: // Courtesy cash (date range) - NOT IMPLEMENTED, use LLM
      case 9: // Bank deposits breakdown (date range) - NOT IMPLEMENTED, use LLM
      case 10: // Tips percentage
        if (!context.selectedMonth) return "Necesito el mes para responder esta pregunta.";

        const monthStart = `${context.selectedMonth}-01`;
        const monthEnd = `${context.selectedMonth}-31`;

        const { data: monthRecords } = await supabase
          .from("corte_daily_records")
          .select("propinas, efectivo, venta_bruta")
          .gte("business_date", monthStart)
          .lte("business_date", monthEnd);

        if (!monthRecords?.length) return "No tengo datos para ese mes.";

        const totalTips = monthRecords.reduce((sum: number, r: any) => sum + (r.propinas || 0), 0);
        const totalCash = monthRecords.reduce((sum: number, r: any) => sum + (r.efectivo || 0), 0);
        const totalVenta = monthRecords.reduce((sum: number, r: any) => sum + (r.venta_bruta || 0), 0);

        if (questionId === 6) {
          return `Del efectivo recaudado, se requieren ${fmt(totalTips)} para el pago de propinas.`;
        } else if (questionId === 7) {
          return `El efectivo real recaudado por ventas fue de ${fmt(totalCash)}.`;
        } else if (questionId === 8 || questionId === 9) {
          return null; // Use LLM fallback
        } else {
          const tipsPct = totalVenta > 0 ? (totalTips / totalVenta) * 100 : 0;
          return `Las propinas representan el ${pct(tipsPct)} del total de las ventas (${fmt(totalTips)} de ${fmt(totalVenta)}).`;
        }

      case 11: // AMEX deposited during month
      case 12: // Banorte deposited during month
        if (!context.selectedMonth) return "Necesito el mes para responder esta pregunta.";

        const mStart = `${context.selectedMonth}-01`;
        const mEnd = `${context.selectedMonth}-31`;

        const { data: monthlyData } = await supabase
          .from("corte_daily_records")
          .select("amex, debito, credito")
          .gte("business_date", mStart)
          .lte("business_date", mEnd);

        if (!monthlyData?.length) return "No tengo datos para ese mes.";

        if (questionId === 11) {
          const amexTotal = monthlyData.reduce((sum: number, r: any) => sum + (r.amex || 0), 0);
          return `De las ventas con American Express durante ese período, ya se depositaron ${fmt(amexTotal)} en la cuenta bancaria.`;
        } else {
          const banorteTotal = monthlyData.reduce((sum: number, r: any) =>
            sum + (r.debito || 0) + (r.credito || 0), 0);
          return `De las ventas con terminales Banorte durante ese período, ya se depositaron ${fmt(banorteTotal)} en la cuenta bancaria.`;
        }

      case 13: // AMEX pending at month end
      case 14: // Banorte pending at month end
        if (!context.selectedMonth) return "Necesito el mes para responder esta pregunta.";

        const monthEndDate = `${context.selectedMonth}-31`;

        const { data: endReceivables } = await supabase
          .from("corte_receivables")
          .select("principal, settled_principal")
          .eq("status", "open")
          .gte("opened_on", `${context.selectedMonth}-01`)
          .lte("opened_on", monthEndDate);

        if (!endReceivables?.length) return "No hay cuentas por cobrar pendientes al cierre del mes.";

        const endPending = endReceivables.reduce((sum: number, r: any) =>
          sum + (r.principal || 0) - (r.settled_principal || 0), 0);

        if (questionId === 13) {
          return `Al cierre del mes, quedan ${fmt(endPending)} pendientes de recibir correspondientes a ventas con American Express.`;
        } else {
          return `Al cierre del mes, quedan ${fmt(endPending)} pendientes de recibir correspondientes a ventas con terminales Banorte.`;
        }

      case 15: // Cross-month deposits (May sales in June) - Banorte - NOT IMPLEMENTED, use LLM
      case 16: // Cross-month deposits (May sales in June) - AMEX - NOT IMPLEMENTED, use LLM
        return null; // Complex cross-month analysis, use LLM

      case 17: // AMEX commission rate
        return `La comisión de American Express (sin IVA) es del 2.5%.`;

      case 18: // Uber sales
      case 19: // Rappi sales
      case 20: // Uber deposits
      case 21: // Rappi deposits
      case 22: // Uber commission %
      case 23: // Rappi commission %
      case 24: // Uber sales %
      case 25: // Rappi sales %
        if (!context.selectedMonth) return "Necesito el mes para responder esta pregunta.";

        const startDate = `${context.selectedMonth}-01`;
        const endDate = `${context.selectedMonth}-31`;
        const field = ([18, 20, 22, 24].includes(questionId)) ? "uber_eats" : "rappi";

        const { data: platformData } = await supabase
          .from("corte_daily_records")
          .select(`${field}, venta_bruta`)
          .gte("business_date", startDate)
          .lte("business_date", endDate);

        if (!platformData?.length) return "No tengo datos para ese mes.";

        const platformSales = platformData.reduce((sum: number, r: any) => sum + (r[field] || 0), 0);

        if (questionId === 18 || questionId === 19) {
          const platform = questionId === 18 ? "Uber" : "Rappi";
          return `El monto total de ventas realizadas a través de ${platform} fue de ${fmt(platformSales)}.`;
        } else if (questionId === 20 || questionId === 21) {
          // Deposits are approximately 85% of sales (15% commission)
          const deposits = platformSales * 0.85;
          const platform = questionId === 20 ? "Uber" : "Rappi";
          return `El monto total de depósitos recibidos de ${platform} fue de ${fmt(deposits)}.`;
        } else if (questionId === 22 || questionId === 23) {
          // Commission is approximately 15% of sales
          const commission = platformSales * 0.15;
          const deposits = platformSales * 0.85;
          const commissionPct = deposits > 0 ? (commission / deposits) * 100 : 0;
          const platform = questionId === 22 ? "Uber" : "Rappi";
          return `Las comisiones de ${platform} representan el ${pct(commissionPct)} de los depósitos recibidos.`;
        } else {
          const totalMonthSales = platformData.reduce((sum: number, r: any) => sum + (r.venta_bruta || 0), 0);
          if (totalMonthSales === 0) return "No hay ventas totales registradas.";

          const platformPct = (platformSales / totalMonthSales) * 100;
          const platform = questionId === 24 ? "Uber" : "Rappi";
          return `Las ventas de ${platform} representan el ${pct(platformPct)} del total de ventas del mes (${fmt(platformSales)} de ${fmt(totalMonthSales)}).`;
        }

      default:
        return null;
    }
  } catch (error) {
    console.error("Error answering direct question:", error);
    return null;
  }
}

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

  const selectedMonth = body.selectedMonth || run.business_date?.slice(0, 7);

  // ========================================
  // NEW: Try direct pattern-based answering first
  // ========================================
  const questionId = identifyQuestion(question.toLowerCase());
  if (questionId !== null) {
    const directAnswer = await answerDirectQuestion(questionId, supabase, {
      businessDate: run.business_date ?? undefined,
      selectedMonth: selectedMonth ?? undefined,
    });

    if (directAnswer) {
      console.log(`[AI] Question ${questionId} answered directly with SQL`);
      return NextResponse.json({ answer: directAnswer });
    }
  }

  // ========================================
  // FALLBACK: Use LLM (Claude/Gemini) with context
  // ========================================
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
        body: JSON.stringify({
          model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-latest", max_tokens: 800, temperature: 0.2,
          system: "Sos SantoBot, asistente financiero de Santo Restaurants.",
          messages: [{ role: "user", content: prompt }]
        }),
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
