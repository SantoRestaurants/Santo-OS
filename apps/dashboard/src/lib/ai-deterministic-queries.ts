import { SupabaseClient } from "@supabase/supabase-js";

export type DateRange = { start: string; end: string };

function money(amount: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(amount);
}

function pct(amount: number) {
  return `${amount.toFixed(1)}%`;
}

export function classifyQuestion(question: string): number | null {
  const q = question.toLowerCase();
  if (q.includes("american express") && q.includes("deposit") && (q.includes("hoy") || q.includes("día de hoy"))) return 1;
  if (q.includes("banorte") && q.includes("deposit") && (q.includes("hoy") || q.includes("día de hoy"))) return 2;
  if (q.includes("american express") && q.includes("falta") && q.includes("deposit")) return 3;
  if (q.includes("banorte") && q.includes("falta") && q.includes("deposit")) return 4;
  if (q.includes("porcentaje") && (q.includes("cxc") || q.includes("cuentas por cobrar")) && q.includes("ventas totales")) return 5;
  if (q.includes("efectivo") && q.includes("propinas") && (q.includes("entre") || q.includes("durante") || q.includes("requier"))) return 6;
  if (q.includes("efectivo real") && q.includes("ventas") && (q.includes("entre") || q.includes("durante") || q.includes("recaud"))) return 7;
  if (q.includes("cortesías") && q.includes("dirección") && q.includes("efectivo")) return 8;
  if (q.includes("deposit") && q.includes("propinas") && q.includes("ingresos reales")) return 9;
  if (q.includes("porcentaje") && q.includes("propinas") && q.includes("ventas")) return 10;
  if (q.includes("ingresos") && q.includes("mayo") && q.includes("banorte")) return 15;
  if (q.includes("ingres") && q.includes("mayo") && q.includes("american express")) return 16;
  if (q.includes("american express") && q.includes("depositado") && !q.includes("hoy")) return 11;
  if (q.includes("banorte") && q.includes("depositado") && !q.includes("hoy")) return 12;
  if (q.includes("cierre") && q.includes("american express") && q.includes("pendient")) return 13;
  if (q.includes("cierre") && q.includes("banorte") && q.includes("pendient")) return 14;
  if (q.includes("comisión") && q.includes("american express") && q.includes("sin") && q.includes("iva")) return 17;
  if (q.includes("ventas") && q.includes("uber") && !q.includes("porcentaje")) return 18;
  if (q.includes("ventas") && q.includes("rappi") && !q.includes("porcentaje")) return 19;
  if (q.includes("depósitos") && q.includes("uber") && !q.includes("porcentaje")) return 20;
  if (q.includes("depósitos") && q.includes("rappi") && !q.includes("porcentaje")) return 21;
  if (q.includes("porcentaje") && q.includes("comision") && q.includes("uber")) return 22;
  if (q.includes("porcentaje") && q.includes("comision") && q.includes("rappi")) return 23;
  if (q.includes("porcentaje") && q.includes("ventas totales") && q.includes("uber")) return 24;
  if (q.includes("porcentaje") && q.includes("ventas totales") && q.includes("rappi")) return 25;
  return null;
}

export function parseDateFromQuestion(question: string, defaultMonth?: string): DateRange | null {
  const q = question.toLowerCase();
  const months: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
  };
  
  for (const [name, num] of Object.entries(months)) {
    if (q.includes(name)) {
      const year = new Date().getFullYear();
      const start = `${year}-${String(num).padStart(2, '0')}-01`;
      const lastDay = new Date(year, num, 0).getDate();
      const end = `${year}-${String(num).padStart(2, '0')}-${lastDay}`;
      return { start, end };
    }
  }

  const datePattern = /(\d{4}-\d{2}-\d{2})/g;
  const matches = question.match(datePattern);
  if (matches && matches.length >= 2) {
    return { start: matches[0], end: matches[1] };
  }

  if (defaultMonth) {
    const year = parseInt(defaultMonth.slice(0, 4), 10);
    const month = parseInt(defaultMonth.slice(5, 7), 10);
    const start = `${defaultMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${defaultMonth}-${lastDay}`;
    return { start, end };
  }
  return null;
}

export async function calculateDeterministicAnswer(
  qId: number, 
  supabase: SupabaseClient, 
  businessDate: string | null, 
  dateRange: DateRange | null
): Promise<string | null> {
  try {
    // Q1, Q2: Daily deposits
    if (qId === 1 || qId === 2) {
      if (!businessDate) return "Falta la fecha del corte (businessDate).";
      const { data } = await supabase
        .from("workflow_runs")
        .select("output_payload")
        .eq("business_date", businessDate)
        .eq("workflow_key", "corte_santo_daily_sales_reconciliation")
        .eq("source_channel", "agent_mail")
        .order("created_at", { ascending: false })
        .limit(1);
      
      let deposited = 0;
      if (data && data.length > 0) {
        const payload = data[0].output_payload || {};
        const bankRec = payload.bank_reconciliation || {};
        if (qId === 1) { // AMEX
          const batches = bankRec.batch_validation || [];
          deposited = batches.filter((b: any) => b.status === "ok" && b.banorte_deposit).reduce((sum: number, b: any) => sum + Number(b.banorte_deposit), 0);
          if (deposited === 0) {
            deposited = (bankRec.matches || []).filter((m: any) => m.deposit?.source === "amex").reduce((sum: number, m: any) => sum + Number(m.deposit?.amount || 0), 0);
          }
        } else { // Banorte
          const matches = bankRec.matches || [];
          deposited = matches.filter((m: any) => m.deposit?.source === "debito" || m.deposit?.source === "credito").reduce((sum: number, m: any) => sum + Number(m.deposit?.amount || 0), 0);
        }
      }
      return `Monto depositado calculado: ${money(deposited)}`;
    }

    // Q3, Q4: Pending deposits
    if (qId === 3 || qId === 4) {
      if (!businessDate) return "Falta la fecha del corte.";
      
      let pending = 0;
      const { data: runs } = await supabase
        .from("workflow_runs")
        .select("output_payload")
        .eq("business_date", businessDate)
        .eq("workflow_key", "corte_santo_daily_sales_reconciliation")
        .eq("source_channel", "agent_mail")
        .order("created_at", { ascending: false })
        .limit(1);
      
      if (runs && runs.length > 0) {
        const payload = runs[0].output_payload || {};
        const bankRec = payload.bank_reconciliation || {};
        const pendingCols = bankRec.pending_collections || {};
        if (qId === 3) pending = Number(pendingCols["amex"] || 0);
        else pending = Number(pendingCols["debito"] || 0) + Number(pendingCols["credito"] || 0);
      } else {
        return "Todavía no hay una conciliación bancaria disponible para calcular lo pendiente.";
      }
      return `Monto pendiente de depositar calculado: ${money(pending)}`;
    }

    // Q5: CxC vs Sales
    if (qId === 5) {
      if (!dateRange) return "Falta un rango de fechas mensual.";
      const { data: recs } = await supabase.from("corte_receivables").select("principal").gte("opened_on", dateRange.start).lte("opened_on", dateRange.end);
      const { data: sales } = await supabase.from("corte_daily_records").select("venta_bruta").gte("business_date", dateRange.start).lte("business_date", dateRange.end);
      
      const totalCxc = (recs || []).reduce((sum, r) => sum + Number(r.principal || 0), 0);
      const totalSales = (sales || []).reduce((sum, s) => sum + Number(s.venta_bruta || 0), 0);
      const percentage = totalSales > 0 ? (totalCxc / totalSales) * 100 : 0;
      return `Total CxC: ${money(totalCxc)}, Total Ventas: ${money(totalSales)}, Porcentaje: ${pct(percentage)}`;
    }

    // Q6, Q7: Cash and Tips
    if (qId === 6 || qId === 7) {
      if (!dateRange) return "Falta un rango de fechas.";
      const { data } = await supabase.from("corte_daily_records").select("efectivo, propinas").gte("business_date", dateRange.start).lte("business_date", dateRange.end);
      const totalCash = (data || []).reduce((sum, r) => sum + Number(r.efectivo || 0), 0);
      const totalTips = (data || []).reduce((sum, r) => sum + Number(r.propinas || 0), 0);
      if (qId === 6) return `Efectivo total: ${money(totalCash)}. Propinas requeridas: ${money(totalTips)}.`;
      if (qId === 7) return `Efectivo real recaudado por ventas: ${money(totalCash)}`;
    }

    // Q10: Tips %
    if (qId === 10) {
      if (!dateRange) return "Falta un rango de fechas.";
      const { data } = await supabase.from("corte_daily_records").select("venta_bruta, propinas").gte("business_date", dateRange.start).lte("business_date", dateRange.end);
      const totalSales = (data || []).reduce((sum, r) => sum + Number(r.venta_bruta || 0), 0);
      const totalTips = (data || []).reduce((sum, r) => sum + Number(r.propinas || 0), 0);
      const percentage = totalSales > 0 ? (totalTips / totalSales) * 100 : 0;
      return `Total Ventas: ${money(totalSales)}, Total Propinas: ${money(totalTips)}, Porcentaje: ${pct(percentage)}`;
    }

    // Q18, Q19: Platform sales
    if (qId === 18 || qId === 19) {
      if (!dateRange) return "Falta un rango de fechas.";
      const { data } = await supabase.from("corte_daily_records").select("uber_eats, rappi").gte("business_date", dateRange.start).lte("business_date", dateRange.end);
      const totalUber = (data || []).reduce((sum, r) => sum + Number(r.uber_eats || 0), 0);
      const totalRappi = (data || []).reduce((sum, r) => sum + Number(r.rappi || 0), 0);
      if (qId === 18) return `Total ventas Uber: ${money(totalUber)}`;
      if (qId === 19) return `Total ventas Rappi: ${money(totalRappi)}`;
    }

    // Q24, Q25: Platform sales %
    if (qId === 24 || qId === 25) {
      if (!dateRange) return "Falta un rango de fechas.";
      const { data } = await supabase.from("corte_daily_records").select("venta_bruta, uber_eats, rappi").gte("business_date", dateRange.start).lte("business_date", dateRange.end);
      const totalSales = (data || []).reduce((sum, r) => sum + Number(r.venta_bruta || 0), 0);
      const totalUber = (data || []).reduce((sum, r) => sum + Number(r.uber_eats || 0), 0);
      const totalRappi = (data || []).reduce((sum, r) => sum + Number(r.rappi || 0), 0);
      if (qId === 24) return `Total Ventas: ${money(totalSales)}, Uber: ${money(totalUber)}, Porcentaje Uber: ${pct(totalSales > 0 ? (totalUber/totalSales)*100 : 0)}`;
      if (qId === 25) return `Total Ventas: ${money(totalSales)}, Rappi: ${money(totalRappi)}, Porcentaje Rappi: ${pct(totalSales > 0 ? (totalRappi/totalSales)*100 : 0)}`;
    }

    // Platform deposits (Q20, Q21) and commissions (Q22, Q23)
    if ([20, 21, 22, 23].includes(qId)) {
      if (!dateRange) return "Falta un rango de fechas.";
      const { data } = await supabase.from("corte_daily_records").select("uber_eats, rappi").gte("business_date", dateRange.start).lte("business_date", dateRange.end);
      const totalUber = (data || []).reduce((sum, r) => sum + Number(r.uber_eats || 0), 0);
      const totalRappi = (data || []).reduce((sum, r) => sum + Number(r.rappi || 0), 0);
      
      // Rough estimation since we don't have direct access to platform deposits mapped in the DB simply.
      // Following questions.py logic: approx 85% of sales
      const depUber = totalUber * 0.85;
      const depRappi = totalRappi * 0.85;
      
      if (qId === 20) return `Depósitos Uber (estimado 85%): ${money(depUber)}`;
      if (qId === 21) return `Depósitos Rappi (estimado 85%): ${money(depRappi)}`;
      
      const comUber = totalUber - depUber;
      const comRappi = totalRappi - depRappi;
      if (qId === 22) return `Comisión Uber: ${money(comUber)} (${pct(depUber > 0 ? (comUber/depUber)*100 : 0)} de los depósitos)`;
      if (qId === 23) return `Comisión Rappi: ${money(comRappi)} (${pct(depRappi > 0 ? (comRappi/depRappi)*100 : 0)} de los depósitos)`;
    }

    // Defaults / Unimplemented explicit queries - prompt the LLM to figure it out from raw data
    return null;
  } catch (error) {
    console.error("Error in deterministic calculation:", error);
    return null;
  }
}
