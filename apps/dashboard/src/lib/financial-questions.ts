type UnknownRecord = Record<string, unknown>;

export type FinancialQuestionData = {
  question: string;
  periodStart: string;
  periodEnd: string;
  effectiveDate: string;
  dailyRecords: UnknownRecord[];
  receivables: UnknownRecord[];
  bankRuns: UnknownRecord[];
  latestBankRun: UnknownRecord | null;
};

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const number = (value: unknown) => Number(value ?? 0) || 0;
const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percentage = (value: number) => `${value.toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
const sum = (rows: UnknownRecord[], key: string) => rows.reduce((total, row) => total + number(row[key]), 0);

function lastDay(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function resolveFinancialPeriod(question: string, selectedMonth: string, fallbackDate: string) {
  const q = normalize(question);
  const explicit = [...q.matchAll(/(20\d{2}-\d{2}-\d{2})/g)].map((match) => match[1]);
  if (explicit.length >= 2) {
    return { start: explicit[0], end: explicit[1], effectiveDate: explicit[1] };
  }

  const selectedYear = Number(selectedMonth.slice(0, 4)) || Number(fallbackDate.slice(0, 4));
  const candidates = Object.entries(MONTHS)
    .map(([name, month]) => {
      const match = new RegExp(`\\b${name}\\b(?:\\s+(?:de\\s+)?)?(20\\d{2})?`).exec(q);
      return match?.index === undefined ? null : { month, year: Number(match[1]) || selectedYear, index: match.index };
    })
    .filter((candidate): candidate is { month: number; year: number; index: number } => candidate !== null)
    .sort((a, b) => a.index - b.index);
  if (candidates[0]) {
    const { year, month } = candidates[0];
    const end = iso(year, month, lastDay(year, month));
    return { start: iso(year, month, 1), end, effectiveDate: q.includes("cierre") ? end : fallbackDate };
  }

  const [year, month] = selectedMonth.split("-").map(Number);
  const end = iso(year, month, lastDay(year, month));
  return { start: iso(year, month, 1), end, effectiveDate: fallbackDate };
}

function dateKey(value: unknown) {
  if (typeof value !== "string") return null;
  if (/^20\d{2}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  return match ? iso(Number(match[3]), Number(match[2]), Number(match[1])) : null;
}

type BankDeposit = { amount: number; source: string; date: string | null; expected: UnknownRecord[]; description: string };

function bankDeposits(runs: UnknownRecord[]) {
  const unique = new Map<string, BankDeposit>();
  for (const run of runs) {
    const payload = run.output_payload as UnknownRecord | null;
    const bank = payload?.bank_reconciliation as UnknownRecord | null;
    if (!bank) continue;
    const add = (raw: UnknownRecord, expected: UnknownRecord[] = []) => {
      const amount = number(raw.amount);
      const source = String(raw.source ?? "").toLowerCase();
      const date = dateKey(raw.operation_date);
      if (!amount || !source || !date) return;
      const description = String(raw.description ?? raw.detail ?? "");
      unique.set(`${date}|${source}|${amount}|${description}`, { amount, source, date, expected, description });
    };
    for (const match of Array.isArray(bank.matches) ? bank.matches : []) {
      if (!match || typeof match !== "object") continue;
      const item = match as UnknownRecord;
      if (item.deposit && typeof item.deposit === "object") add(item.deposit as UnknownRecord, Array.isArray(item.expected_group) ? item.expected_group as UnknownRecord[] : []);
    }
    for (const deposit of Array.isArray(bank.deposits) ? bank.deposits : []) {
      if (deposit && typeof deposit === "object") add(deposit as UnknownRecord);
    }
  }
  return [...unique.values()];
}

function pendingAtSnapshot(run: UnknownRecord | null, channel: string, start: string, end: string) {
  const bank = (run?.output_payload as UnknownRecord | undefined)?.bank_reconciliation as UnknownRecord | undefined;
  const items = Array.isArray(bank?.pending_items) ? bank.pending_items : [];
  return items.reduce((total, item) => {
    if (!item || typeof item !== "object") return total;
    const row = item as UnknownRecord;
    const sourceDate = String(row.source_date ?? row.business_date ?? "");
    const itemChannel = String(row.channel ?? "").toLowerCase();
    const channelMatches = channel === "banorte" ? ["banorte", "debito", "credito"].includes(itemChannel) : itemChannel === channel;
    return channelMatches && sourceDate >= start && sourceDate <= end
      ? total + number(row.expected_deposit ?? row.amount) : total;
  }, 0);
}

function coverage(data: FinancialQuestionData) {
  const start = new Date(`${data.periodStart}T00:00:00Z`);
  const expected = Math.round((new Date(`${data.periodEnd}T00:00:00Z`).getTime() - start.getTime()) / 86_400_000) + 1;
  const loaded = new Set(data.dailyRecords.map((row) => String(row.business_date))).size;
  return { loaded, expected, complete: loaded === expected };
}

function has(question: string, ...words: string[]) {
  return words.every((word) => question.includes(word));
}

export function answerFinancialQuestion(data: FinancialQuestionData) {
  const q = normalize(data.question);
  const rangeNeedsDates = q.includes("[fecha inicial]") || q.includes("[fecha final]");
  if (rangeNeedsDates) return "Decime las dos fechas del período y lo calculo.";

  const period = `${data.periodStart} al ${data.periodEnd}`;
  const state = coverage(data);
  if (q.includes("cierre") && !state.complete) {
    return `Todavía no puedo dar el cierre de ese mes: hay datos cargados para ${state.loaded} de ${state.expected} días.`;
  }
  const deposits = bankDeposits(data.bankRuns);
  const periodDeposits = deposits.filter((deposit) => deposit.date && deposit.date >= data.periodStart && deposit.date <= data.periodEnd);

  if (has(q, "american express", "deposito", "dia de hoy")) {
    const total = deposits.filter((deposit) => deposit.source === "amex" && deposit.date === data.effectiveDate).reduce((value, row) => value + row.amount, 0);
    return total ? `Hoy, ${data.effectiveDate}, ingresaron ${money(total)} de American Express.` : `No hay depósitos de American Express conciliados para ${data.effectiveDate}.`;
  }
  if (has(q, "banorte", "deposito", "dia de hoy")) {
    const total = deposits.filter((deposit) => deposit.source === "banorte" && deposit.date === data.effectiveDate).reduce((value, row) => value + row.amount, 0);
    return total ? `Hoy, ${data.effectiveDate}, ingresaron ${money(total)} de Banorte.` : `No hay depósitos de Banorte conciliados para ${data.effectiveDate}.`;
  }

  if (has(q, "porcentaje", "cuentas por cobrar", "ventas totales") || has(q, "porcentaje", "cxc", "ventas totales")) {
    const receivables = data.receivables.filter((row) => String(row.opened_on) >= data.periodStart && String(row.opened_on) <= data.periodEnd);
    const cxc = sum(receivables, "principal");
    const sales = sum(data.dailyRecords, "venta_bruta");
    return sales ? `Las cuentas por cobrar registradas entre ${period} fueron ${money(cxc)}: representan ${percentage((cxc / sales) * 100)} de las ventas totales (${money(sales)}).` : "No hay ventas cargadas para ese período.";
  }
  if (has(q, "efectivo", "propinas")) return `Del efectivo recaudado entre ${period}, se requieren ${money(sum(data.dailyRecords, "propinas"))} para cubrir propinas.`;
  if (has(q, "efectivo real", "ventas")) return `El efectivo real recaudado por ventas entre ${period} fue ${money(sum(data.dailyRecords, "efectivo"))}.`;
  if (has(q, "cortesias", "direccion", "efectivo")) {
    const total = data.dailyRecords.reduce((value, row) => value + number((row.extra_values as UnknownRecord | null)?.cortesia_direccion), 0);
    return total ? `El efectivo registrado por cortesías de dirección entre ${period} fue ${money(total)}.` : `No hay cortesías de dirección registradas en los cortes cargados entre ${period}.`;
  }
  if (has(q, "porcentaje", "propinas", "ventas")) {
    const tips = sum(data.dailyRecords, "propinas"); const sales = sum(data.dailyRecords, "venta_bruta");
    return sales ? `Las propinas representan ${percentage((tips / sales) * 100)} de las ventas: ${money(tips)} de ${money(sales)}.` : "No hay ventas cargadas para ese período.";
  }
  if (has(q, "dinero depositado", "propinas", "ingresos reales")) {
    return "No puedo separar propinas e ingresos reales dentro de los depósitos bancarios sin el detalle de origen de cada depósito. Esa conciliación debe quedar registrada antes de dar una cifra.";
  }
  if (has(q, "porcentaje", "comision", "american express")) {
    const amex = periodDeposits.filter((deposit) => deposit.source === "amex");
    const paymentLines = amex.flatMap((deposit) => deposit.expected.map((row) => row._original_amex as UnknownRecord | null).filter(Boolean) as UnknownRecord[]);
    const gross = paymentLines.reduce((total, payment) => total + number(payment.cargos ?? payment.gross_amount), 0);
    const net = paymentLines.reduce((total, payment) => total + number(payment.neto ?? payment.amount), 0);
    return gross ? `La comisión efectiva observada de American Express fue ${percentage(((gross - net) / gross) * 100)}, sin IVA.` : "No hay conciliaciones suficientes de American Express para calcular su comisión.";
  }
  if (has(q, "ventas", "uber") && !q.includes("porcentaje")) return `Las ventas de Uber entre ${period} fueron ${money(sum(data.dailyRecords, "uber_eats"))}.`;
  if (has(q, "ventas", "rappi") && !q.includes("porcentaje")) return `Las ventas de Rappi entre ${period} fueron ${money(sum(data.dailyRecords, "rappi"))}.`;
  if (has(q, "porcentaje", "ventas totales", "uber")) {
    const sales = sum(data.dailyRecords, "venta_bruta"); return sales ? `Uber representa ${percentage((sum(data.dailyRecords, "uber_eats") / sales) * 100)} de las ventas totales.` : "No hay ventas cargadas para ese período.";
  }
  if (has(q, "porcentaje", "ventas totales", "rappi")) {
    const sales = sum(data.dailyRecords, "venta_bruta"); return sales ? `Rappi representa ${percentage((sum(data.dailyRecords, "rappi") / sales) * 100)} de las ventas totales.` : "No hay ventas cargadas para ese período.";
  }
  if (q.includes("american express") && q.includes("deposit") && q.includes("ventas realizadas")) {
    const matched = deposits.filter((deposit) => deposit.source === "amex" && deposit.expected.some((row) => {
      const sourceDate = String(row.source_date ?? "");
      return sourceDate >= data.periodStart && sourceDate <= data.periodEnd;
    }));
    return matched.length ? `De las ventas de American Express entre ${period}, hay ${money(matched.reduce((total, row) => total + row.amount, 0))} ya conciliados como depósitos bancarios.` : "Todavía no hay depósitos de American Express conciliados con ventas de ese período.";
  }
  if ((q.includes("banorte") || q.includes("terminales")) && q.includes("deposit") && q.includes("ventas procesadas")) {
    const matched = deposits.filter((deposit) => deposit.source === "banorte" && deposit.expected.some((row) => {
      const sourceDate = String(row.source_date ?? "");
      return sourceDate >= data.periodStart && sourceDate <= data.periodEnd;
    }));
    return matched.length ? `De las ventas Banorte entre ${period}, hay ${money(matched.reduce((total, row) => total + row.amount, 0))} ya conciliados como depósitos bancarios.` : "Todavía no hay depósitos Banorte conciliados con ventas de ese período.";
  }
  if (has(q, "pendientes", "american express") || has(q, "pendiente", "american express") || has(q, "falta por depositarse", "american express")) {
    const pending = pendingAtSnapshot(data.latestBankRun, "amex", data.periodStart, data.periodEnd);
    if (!data.latestBankRun) return "No hay una conciliación bancaria disponible para verificar ese pendiente.";
    return pending === 0 ? "$0.00 (Ya ingresó todo al banco)." : `El último corte bancario disponible muestra ${money(pending)} pendiente de American Express para ventas de ese período.`;
  }
  if (has(q, "pendiente", "banorte") || has(q, "pendientes", "banorte") || has(q, "pendiente", "terminales") || has(q, "falta por depositarse", "banorte") || has(q, "falta por depositarse", "terminales")) {
    const pending = pendingAtSnapshot(data.latestBankRun, "banorte", data.periodStart, data.periodEnd);
    if (!data.latestBankRun) return "No hay una conciliación bancaria disponible para verificar ese pendiente.";
    return pending === 0 ? "$0.00 (Ya ingresó todo al banco)." : `El último corte bancario disponible muestra ${money(pending)} pendiente de Banorte para ventas de ese período.`;
  }
  if (has(q, "ingresos depositados", "mayo", "banorte")) {
    const previousMonth = `${data.periodStart.slice(0, 4)}-05`;
    const matched = periodDeposits.filter((deposit) => deposit.source === "banorte" && deposit.expected.some((row) => String(row.source_date).startsWith(previousMonth)));
    return matched.length ? `Depósitos Banorte de ventas de mayo:\n${matched.map((row) => `• ${row.date}: ${money(row.amount)}`).join("\n")}` : "No hay depósitos Banorte conciliados con ventas de mayo en el período consultado.";
  }
  if (has(q, "mayo", "american express", "ingreso")) {
    const matched = periodDeposits.filter((deposit) => deposit.source === "amex" && deposit.expected.some((row) => String(row.source_date).slice(5, 7) === "05"));
    return `Ingresaron ${money(matched.reduce((total, row) => total + row.amount, 0))} de American Express por ventas de mayo.`;
  }
  if (has(q, "depositos", "uber")) {
    if (q.includes("comisiones")) return "No puedo calcular la comisión de Uber sin depósitos conciliados con sus ventas de origen.";
    const total = periodDeposits.filter((deposit) => deposit.source === "uber").reduce((value, row) => value + row.amount, 0);
    return total ? `Los depósitos conciliados de Uber entre ${period} fueron ${money(total)}.` : "No hay depósitos de Uber conciliados para ese período.";
  }
  if (has(q, "depositos", "rappi")) {
    if (q.includes("comisiones")) return "No puedo calcular la comisión de Rappi sin depósitos conciliados con sus ventas de origen.";
    const total = periodDeposits.filter((deposit) => deposit.source === "rappi").reduce((value, row) => value + row.amount, 0);
    return total ? `Los depósitos conciliados de Rappi entre ${period} fueron ${money(total)}.` : "No hay depósitos de Rappi conciliados para ese período.";
  }
  if (has(q, "deposito", "american express")) {
    const total = periodDeposits.filter((deposit) => deposit.source === "amex").reduce((value, row) => value + row.amount, 0);
    return total ? `Los depósitos conciliados de American Express entre ${period} fueron ${money(total)}.` : "No hay depósitos de American Express conciliados para ese período.";
  }
  if (has(q, "deposito", "banorte")) {
    const total = periodDeposits.filter((deposit) => deposit.source === "banorte").reduce((value, row) => value + row.amount, 0);
    return total ? `Los depósitos conciliados de Banorte entre ${period} fueron ${money(total)}.` : "No hay depósitos de Banorte conciliados para ese período.";
  }
  return null;
}

/** Compact, auditable context for the conversational fallback. Calculations stay
 * in this module; the model only interprets wording and writes the response. */
export function financialFacts(data: FinancialQuestionData) {
  const deposits = bankDeposits(data.bankRuns);
  const periodDeposits = deposits.filter((deposit) => deposit.date && deposit.date >= data.periodStart && deposit.date <= data.periodEnd);
  const bank = (data.latestBankRun?.output_payload as UnknownRecord | undefined)?.bank_reconciliation as UnknownRecord | undefined;
  const pending = Array.isArray(bank?.pending_items) ? bank.pending_items : [];
  return {
    period: { start: data.periodStart, end: data.periodEnd, coverage: coverage(data) },
    sales: {
      venta_bruta: sum(data.dailyRecords, "venta_bruta"), propinas: sum(data.dailyRecords, "propinas"),
      efectivo: sum(data.dailyRecords, "efectivo"), amex: sum(data.dailyRecords, "amex"),
      banorte_terminales: sum(data.dailyRecords, "debito") + sum(data.dailyRecords, "credito"),
      uber: sum(data.dailyRecords, "uber_eats"), rappi: sum(data.dailyRecords, "rappi"),
    },
    receivables: data.receivables.map((row) => ({ opened_on: row.opened_on, principal: row.principal, settled_on: row.settled_on, status: row.status })),
    bank: {
      snapshot_business_date: data.latestBankRun?.business_date ?? null,
      pending_items: pending,
      deposits: periodDeposits.map((deposit) => ({ date: deposit.date, source: deposit.source, amount: deposit.amount, sales_sources: deposit.expected.map((row) => row.source_date) })),
    },
  };
}
