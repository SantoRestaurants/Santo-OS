type DocumentLike = {
  document_type?: string | null;
  document_key?: string | null;
  source_uri?: string | null;
  drive_file_id?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
  workflow_runs?: { business_date: string | null } | Array<{ business_date: string | null }> | null;
};

type RunLike = {
  business_date: string | null;
  created_at: string;
  status: string;
  output_payload?: Record<string, unknown> | null;
  revision?: {
    vta_por_dia?: Array<{ fecha?: string | null; meta_vta?: number | null; venta_real?: number | null }>;
    vta_al_dia?: { venta_real?: number | null; meta_vta?: number | null };
    reconciliation_totals?: { total_real?: number | null; total_sistema?: number | null; difference?: number | null };
    daily_financial_record?: { venta_bruta?: number | null; total_bruto?: number | null };
    falta_por_entrar?: Record<string, number>;
  } | null;
  documents?: DocumentLike[];
  exceptions?: unknown[];
  reviews?: unknown[];
};

const SPANISH_MONTHS: Record<string, string> = {
  enero: "01",
  febrero: "02",
  marzo: "03",
  abril: "04",
  mayo: "05",
  junio: "06",
  julio: "07",
  agosto: "08",
  septiembre: "09",
  setiembre: "09",
  octubre: "10",
  noviembre: "11",
  diciembre: "12",
};

export function docName(doc: DocumentLike) {
  return String(doc.metadata?.name ?? doc.metadata?.original_filename ?? doc.document_key ?? doc.document_type ?? "Archivo");
}

export function driveUrl(fileId: string | null | undefined) {
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : null;
}

export function extractDateFromDocument(doc: DocumentLike): string | null {
  const relation = doc.workflow_runs;
  const linkedDate = Array.isArray(relation) ? relation[0]?.business_date : relation?.business_date;
  if (linkedDate) return linkedDate;

  const explicit = doc.metadata?.business_date ?? doc.metadata?.date;
  if (typeof explicit === "string" && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;

  return extractDateFromText(docName(doc)) ?? extractDateFromText(String(doc.document_key ?? ""));
}

export function extractMonthFromDocument(doc: DocumentLike) {
  const explicit = String(doc.metadata?.month ?? "");
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;

  const date = extractDateFromDocument(doc);
  if (date) return date.slice(0, 7);

  const text = `${docName(doc)} ${doc.document_key ?? ""}`.toLowerCase();
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const month = Object.entries(SPANISH_MONTHS).find(([name]) => text.includes(name))?.[1];
  if (yearMatch && month) return `${yearMatch[1]}-${month}`;

  return doc.created_at?.slice(0, 7) ?? new Date().toISOString().slice(0, 7);
}

export function resolveDailyForecast(
  date: string,
  run: RunLike | null,
  forecastDocuments: Array<{ metadata?: Record<string, unknown> }>
): number | null {
  // 1. Try corte_daily_records.forecast_target
  if (run) {
    const dailyRecord = run.output_payload?.daily_record;
    if (isRecord(dailyRecord) && typeof dailyRecord.forecast_target === "number") {
      return dailyRecord.forecast_target;
    }
  }

  // 2. Try revision.vta_por_dia exact row
  if (run) {
    const row = run.revision?.vta_por_dia?.find((item) => item.fecha === date);
    if (typeof row?.meta_vta === "number") return row.meta_vta;
  }

  // 3. Try monthly forecast document
  const month = date.slice(0, 7);
  const forecastDoc = forecastDocuments.find(doc => {
    const meta = doc.metadata as Record<string, unknown>;
    return meta?.month === month;
  });
  if (forecastDoc) {
    const vta = (forecastDoc.metadata as Record<string, unknown>)?.vta_por_dia;
    if (Array.isArray(vta)) {
      const dayRow = vta.find((item: any) => item.fecha === date);
      if (typeof dayRow?.meta_vta === "number") return dayRow.meta_vta;
    }
  }

  return null;
}

export function hasForecastSourceForMonth(runs: RunLike[], month: string, forecastDocuments?: Array<{ metadata?: Record<string, unknown> }>) {
  // Check runs first
  const hasRunForecast = runs.some((run) => {
    if (run.revision?.vta_por_dia?.some((item) => item.fecha?.startsWith(`${month}-`) && typeof item.meta_vta === "number")) {
      return true;
    }
    const payload = run.output_payload ?? {};
    const driveIds = payload.drive_file_ids;
    const workbookPaths = payload.workbook_paths;
    if (isRecord(driveIds) && typeof driveIds.forecast === "string" && driveIds.forecast) return true;
    if (isRecord(workbookPaths) && typeof workbookPaths.forecast === "string" && workbookPaths.forecast) return true;
    return (run.documents ?? []).some((doc) => {
      if (doc.document_type !== "forecast_workbook") return false;
      return extractMonthFromDocument(doc) === month;
    });
  });

  if (hasRunForecast) return true;

  // Check registered forecast documents
  if (forecastDocuments) {
    return forecastDocuments.some(doc => {
      const meta = doc.metadata as Record<string, unknown>;
      return meta?.month === month;
    });
  }

  return false;
}

export function dailyForecastMeta(run: RunLike, forecastDocuments?: Array<{ metadata?: Record<string, unknown> }>) {
  if (!run.business_date) return null;
  return resolveDailyForecast(run.business_date, run, forecastDocuments ?? []);
}

export function dailySales(run: RunLike) {
  const dailyRecord = run.output_payload?.daily_record;
  if (isRecord(dailyRecord) && typeof dailyRecord.venta_bruta === "number") {
    return dailyRecord.venta_bruta;
  }
  const persistedDaily = run.revision?.daily_financial_record?.venta_bruta;
  if (typeof persistedDaily === "number") return persistedDaily;
  const date = run.business_date;
  const row = run.revision?.vta_por_dia?.find((item) => item.fecha === date);
  if (typeof row?.venta_real === "number" && row.venta_real > 0) return row.venta_real;

  return 0;
}

export function dedupeRunsByDay<T extends RunLike>(runs: T[]) {
  const byDay = new Map<string, T[]>();
  for (const run of runs) {
    if (!run.business_date) continue;
    const current = byDay.get(run.business_date) ?? [];
    current.push(run);
    byDay.set(run.business_date, current);
  }

  const dedupedRuns = Array.from(byDay.values())
    .map((items) => items.sort(compareRunQuality)[0]);

  // Inject "today" stub if it doesn't exist
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  if (!byDay.has(today)) {
    const stubRun = {
      id: "stub-today",
      business_date: today,
      created_at: new Date().toISOString(),
      status: "pending_corte",
      source_channel: "system",
      requires_review_reason: null,
      output_payload: {},
      revision: null,
      email: null,
      documents: [],
      reviews: [],
      exceptions: []
    } as unknown as T;
    dedupedRuns.push(stubRun);
  }

  return dedupedRuns.sort((a, b) => String(b.business_date).localeCompare(String(a.business_date)));
}

export function duplicateRunsByDay<T extends RunLike>(runs: T[]) {
  return Array.from(
    runs.reduce((map, run) => {
      if (!run.business_date) return map;
      const current = map.get(run.business_date) ?? [];
      current.push(run);
      map.set(run.business_date, current);
      return map;
    }, new Map<string, T[]>())
  ).filter(([, items]) => items.length > 1);
}

export type OutstandingSnapshot = {
  asOfDate: string;
  entries: Array<{ channel: string; amount: number }>;
  total: number;
};

export type CorteReceivableLike = {
  restaurant_id: string;
  receivable_key: string;
  opened_on?: string;
  principal: number | string;
  settled_principal: number | string;
  status: string;
  evidence?: Record<string, unknown> | null;
};

export function getOutstandingThroughDate(runs: RunLike[], receivables: CorteReceivableLike[], throughDate: string): OutstandingSnapshot | null {
  // Find the most recent run that has bank reconciliation to determine the "asOfDate"
  const candidates = runs
    .filter((run) => Boolean(run.business_date && run.business_date <= throughDate))
    .sort((a, b) => (b.business_date as string).localeCompare(a.business_date as string) || b.created_at.localeCompare(a.created_at));

  const latestBankRun = candidates.find((run) => {
    const payload = run.output_payload ?? {};
    const bankReconciliation = isRecord(payload.bank_reconciliation) ? payload.bank_reconciliation : null;
    const bankStage = isRecord(payload.bank_stage) ? payload.bank_stage : null;
    const nestedBankReconciliation = bankStage && isRecord(bankStage.bank_reconciliation)
      ? bankStage.bank_reconciliation
      : null;
    return bankReconciliation || nestedBankReconciliation;
  });

  if (!latestBankRun) return null;

  const asOfDate = latestBankRun.business_date as string;

  const entriesMap = new Map<string, number>();
  const representedReceivables = new Set<string>();
  const payload = latestBankRun.output_payload ?? {};
  const bankReconciliation = isRecord(payload.bank_reconciliation) ? payload.bank_reconciliation : null;
  const bankStage = isRecord(payload.bank_stage) ? payload.bank_stage : null;
  const nestedBankReconciliation = bankStage && isRecord(bankStage.bank_reconciliation)
    ? bankStage.bank_reconciliation
    : null;
  const bank = bankReconciliation ?? nestedBankReconciliation;

  const pendingItems = Array.isArray(bank?.pending_items) ? bank.pending_items : [];
  for (const raw of pendingItems) {
    if (!isRecord(raw)) continue;
    const amount = amountOf(raw.expected_deposit ?? raw.amount);
    if (amount <= 0) continue;
    const channel = normalizeOutstandingChannel(String(raw.channel ?? "unclassified"), raw);
    if (channel === "No bancario") continue;
    entriesMap.set(channel, (entriesMap.get(channel) ?? 0) + amount);
    if (typeof raw.receivable_id === "string") representedReceivables.add(raw.receivable_id);
    if (typeof raw.receivable_key === "string") representedReceivables.add(raw.receivable_key);
  }

  if (pendingItems.length === 0 && isRecord(bank?.pending_collections)) {
    for (const [channel, value] of Object.entries(bank.pending_collections)) {
      const amount = amountOf(value);
      if (amount > 0) entriesMap.set(channel, (entriesMap.get(channel) ?? 0) + amount);
    }
  }

  for (const rec of receivables) {
    if (rec.status !== "open") continue;
    if (!isCanonicalReceivable(rec)) continue;
    if (representedReceivables.has(rec.receivable_key)) continue;
    const amount = amountOf(rec.principal) - amountOf(rec.settled_principal);
    if (amount <= 0 || Number.isNaN(amount)) continue;
    const channel = normalizeReceivableChannel(rec);
    entriesMap.set(channel, (entriesMap.get(channel) ?? 0) + amount);
  }

  const entries = Array.from(entriesMap.entries())
    .map(([channel, amount]) => ({ channel, amount }))
    .sort((a, b) => b.amount - a.amount || a.channel.localeCompare(b.channel));

  return {
    asOfDate,
    entries,
    total: entries.reduce((sum, entry) => sum + entry.amount, 0),
  };
}

function amountOf(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeOutstandingChannel(channel: string, item?: Record<string, unknown>) {
  const key = channel.toLowerCase();
  if (key === "uber_eats" || key === "ubereats") return "uber";
  if (key === "cxc") return "CXC";
  if (["amex", "banorte", "uber", "rappi", "paypal", "transferencia"].includes(key)) return key;
  if (key === "debito" || key === "credito") return "banorte";
  if (key === "efectivo" || key === "propinas") return "No bancario";
  const description = item?.description ?? item?.receivable_key;
  return typeof description === "string" && description ? `Otros (${description})` : `Otros (${channel})`;
}

function normalizeReceivableChannel(rec: CorteReceivableLike) {
  const ev = rec.evidence;
  const evidenceChannel = typeof ev?.channel === "string" ? ev.channel : null;
  if (evidenceChannel) return normalizeOutstandingChannel(evidenceChannel, ev ?? undefined);
  const parts = rec.receivable_key.split(":");
  const raw = parts.length >= 3 ? parts[2] : (parts.length === 2 ? parts[1] : "cxc");
  const normalized = normalizeOutstandingChannel(raw, ev ?? undefined);
  if (!normalized.startsWith("Otros")) return normalized;
  const description = typeof ev?.description === "string" ? ev.description : null;
  return description ? `CXC (${description})` : "CXC";
}

function isCanonicalReceivable(rec: CorteReceivableLike) {
  const ev = rec.evidence;
  if (!ev || Object.keys(ev).length === 0) return false;
  if (ev.kind === "opening" || ev.kind === "settlement") return true;
  if (ev.source === "email_body" || ev.source === "vision_extractor") return true;
  return Boolean(ev.description || ev.movement_id);
}
function compareRunQuality(a: RunLike, b: RunLike) {
  return scoreRun(b) - scoreRun(a) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

function scoreRun(run: RunLike) {
  let score = 0;
  // Bank-validated runs should ALWAYS win, even over revision data
  const op = run.output_payload ?? {};
  if (op.bank_validation_status === "bank_validated" || op.stage === "bank_validated") score += 200;
  if (run.revision?.reconciliation_totals?.total_real) score += 100;
  if (dailyForecastMeta(run) != null) score += 20;
  if ((run.documents ?? []).length) score += 10;
  if ((run.reviews ?? []).length) score += 5;
  if ((run.exceptions ?? []).length) score += 2;
  if (run.status === "completed" || run.status === "bank_validated") score += 15;
  return score;
}

function extractDateFromText(value: string) {
  const text = value.toLowerCase();
  const iso = text.match(/\b(20\d{2})[-_ ]?(\d{2})[-_ ]?(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const spanish = text.match(/\b(\d{1,2})\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(20\d{2})\b/);
  if (!spanish) return null;
  return `${spanish[3]}-${SPANISH_MONTHS[spanish[2]]}-${spanish[1].padStart(2, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getMonthlyTotals(monthRuns: RunLike[], selectedMonth: string, forecastDocuments?: Array<{ metadata?: Record<string, unknown> }>) {
  const forecastReady = hasForecastSourceForMonth(monthRuns, selectedMonth, forecastDocuments);
  const latestRunWithForecast = monthRuns.find((run) => run.revision?.vta_por_dia && run.revision.vta_por_dia.length > 0);

  // Find the latest date with actual data to cap month-to-date calculations
  const runsWithSales = monthRuns.filter(r => dailySales(r) > 0);
  const latestDateWithData = runsWithSales.length > 0
    ? runsWithSales.reduce((latest, r) => (r.business_date && (!latest || r.business_date > latest) ? r.business_date : latest), null as string | null)
    : monthRuns.length > 0
      ? monthRuns.reduce((latest, r) => (r.business_date && (!latest || r.business_date > latest) ? r.business_date : latest), null as string | null)
      : null;

  const isUpTo = (date: string | null | undefined) => {
    if (!latestDateWithData || !date) return true;
    return date <= latestDateWithData;
  };

  if (forecastReady && latestRunWithForecast?.revision?.vta_por_dia) {
    const vta = latestRunWithForecast.revision.vta_por_dia;
    // Full month meta (always show full target)
    const monthMeta = vta.reduce((sum, item) => sum + (typeof item.meta_vta === "number" ? item.meta_vta : 0), 0);

    let monthTotal = vta.reduce((sum, item) => {
      const date = item.fecha;
      const runForDay = date ? monthRuns.find(r => r.business_date === date) : null;
      if (runForDay) {
        return sum + dailySales(runForDay);
      }
      return sum + (typeof item.venta_real === "number" ? item.venta_real : 0);
    }, 0);

    const datesInVta = new Set(vta.map(item => item.fecha).filter(Boolean));
    for (const run of monthRuns) {
      if (run.business_date && !datesInVta.has(run.business_date)) {
        monthTotal += dailySales(run);
      }
    }

    // Meta up to latest date (for difference calculation)
    const monthMetaToDate = vta
      .filter(item => isUpTo(item.fecha))
      .reduce((sum, item) => sum + (typeof item.meta_vta === "number" ? item.meta_vta : 0), 0);

    return { monthTotal, monthMeta, monthMetaToDate };
  }

  const monthTotal = monthRuns.reduce((sum, run) => sum + dailySales(run), 0);
  const monthMeta = forecastReady ? monthRuns.reduce((sum, run) => sum + (dailyForecastMeta(run) ?? 0), 0) : null;
  const monthMetaToDate = forecastReady ? monthRuns.reduce((sum, run) => sum + (isUpTo(run.business_date) ? (dailyForecastMeta(run) ?? 0) : 0), 0) : null;

  return { monthTotal, monthMeta, monthMetaToDate };
}
