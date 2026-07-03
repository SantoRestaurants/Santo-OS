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

export function hasForecastSourceForMonth(runs: RunLike[], month: string) {
  return runs.some((run) => {
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
}

export function dailyForecastMeta(run: RunLike) {
  const date = run.business_date;
  if (!date) return null;
  const row = run.revision?.vta_por_dia?.find((item) => item.fecha === date);
  return typeof row?.meta_vta === "number" ? row.meta_vta : null;
}

export function dailySales(run: RunLike) {
  const dailyRecord = run.output_payload?.daily_record;
  if (isRecord(dailyRecord) && typeof dailyRecord.venta_bruta === "number") {
    return dailyRecord.venta_bruta;
  }
  const total = run.revision?.reconciliation_totals?.total_real;
  if (typeof total === "number") return total;

  const date = run.business_date;
  const row = run.revision?.vta_por_dia?.find((item) => item.fecha === date);
  if (typeof row?.venta_real === "number" && row.venta_real > 0) return row.venta_real;

  return run.revision?.vta_al_dia?.venta_real ?? 0;
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

export function getOutstandingThroughDate(runs: RunLike[], throughDate: string): OutstandingSnapshot | null {
  const candidates = runs
    .filter((run) => Boolean(run.business_date && run.business_date <= throughDate))
    .map((run) => {
      const payload = run.output_payload ?? {};
      const revisionDocument = isRecord(payload.revision_document) ? payload.revision_document : null;
      const bankReconciliation = isRecord(payload.bank_reconciliation) ? payload.bank_reconciliation : null;
      const bankStage = isRecord(payload.bank_stage) ? payload.bank_stage : null;
      const nestedBankReconciliation = bankStage && isRecord(bankStage.bank_reconciliation)
        ? bankStage.bank_reconciliation
        : null;
      const raw = run.revision?.falta_por_entrar
        ?? (revisionDocument && isRecord(revisionDocument.falta_por_entrar) ? revisionDocument.falta_por_entrar : null)
        ?? (bankReconciliation && isRecord(bankReconciliation.pending_collections) ? bankReconciliation.pending_collections : null)
        ?? (nestedBankReconciliation && isRecord(nestedBankReconciliation.pending_collections) ? nestedBankReconciliation.pending_collections : null);

      if (!raw) return null;
      const entries = Object.entries(raw)
        .map(([channel, amount]) => ({ channel, amount: Number(amount) }))
        .filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0)
        .sort((a, b) => b.amount - a.amount || a.channel.localeCompare(b.channel));
      if (entries.length === 0) return null;

      return {
        asOfDate: run.business_date as string,
        createdAt: run.created_at,
        entries,
        total: entries.reduce((sum, entry) => sum + entry.amount, 0),
      };
    })
    .filter((item): item is OutstandingSnapshot & { createdAt: string } => item !== null)
    .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate) || b.createdAt.localeCompare(a.createdAt));

  const latest = candidates[0];
  if (!latest) return null;
  return { asOfDate: latest.asOfDate, entries: latest.entries, total: latest.total };
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

export function getMonthlyTotals(monthRuns: RunLike[], selectedMonth: string) {
  const forecastReady = hasForecastSourceForMonth(monthRuns, selectedMonth);
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
