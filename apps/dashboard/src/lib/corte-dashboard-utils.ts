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

const SALDO_KEYS = ["banorte", "amex", "efectivo", "aguinaldos", "utilidades"] as const;

export function getLatestSaldos(runs: RunLike[]) {
  const sorted = [...runs]
    .filter((run) => Boolean(run.business_date))
    .sort((a, b) => String(b.business_date).localeCompare(String(a.business_date)) || b.created_at.localeCompare(a.created_at));
  for (const run of sorted) {
    const saldos = run.output_payload?.saldos;
    if (!isRecord(saldos)) continue;
    if (!SALDO_KEYS.some((key) => typeof saldos[key] === "number")) continue;
    return { saldos: saldos as Record<string, number>, businessDate: run.business_date };
  }
  return { saldos: {} as Record<string, number>, businessDate: null };
}

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
  // CxC is a lifecycle ledger. When its open items are available, they are
  // more precise than the aggregate CxC amount retained in a bank snapshot.
  const hasOpenReceivables = receivables.some((rec) => {
    if (!isCanonicalCxcReceivable(rec) || (rec.opened_on && rec.opened_on > throughDate)) return false;
    const outstanding = amountOf(rec.principal) - amountOf(rec.settled_principal);
    return rec.status === "open" && outstanding > 0 && !Number.isNaN(outstanding);
  });
  const payload = latestBankRun.output_payload ?? {};
  const bankReconciliation = isRecord(payload.bank_reconciliation) ? payload.bank_reconciliation : null;
  const bankStage = isRecord(payload.bank_stage) ? payload.bank_stage : null;
  const nestedBankReconciliation = bankStage && isRecord(bankStage.bank_reconciliation)
    ? bankStage.bank_reconciliation
    : null;
  const bank = bankReconciliation ?? nestedBankReconciliation;

  const pendingItems = Array.isArray(bank?.pending_items) ? bank.pending_items : [];
  const snapshotHasBanorte = pendingItems.some((raw) => (
    isRecord(raw) && normalizeOutstandingChannel(String(raw.channel ?? ""), raw) === "banorte"
  ));
  let legacyBanorteComponents = 0;
  for (const raw of pendingItems) {
    if (!isRecord(raw)) continue;
    const channelRaw = String(raw.channel ?? "unclassified");
    const channelKey = channelRaw.toLowerCase();
    const status = String(raw.status ?? "");
    if (channelRaw !== "amex" && status === "programado") continue;
    if (hasOpenReceivables && channelRaw.toLowerCase() === "cxc") continue;

    const amount = amountOf(raw.amount ?? raw.expected_deposit);
    if (amount <= 0) continue;
    const channel = normalizeOutstandingChannel(channelRaw, raw);
    if (channelKey === "debito" || channelKey === "credito") {
      if (!snapshotHasBanorte) legacyBanorteComponents += amount;
      continue;
    }
    if (!isOutstandingChannel(channel)) continue;
    entriesMap.set(channel, (entriesMap.get(channel) ?? 0) + amount);
    if (typeof raw.receivable_id === "string") representedReceivables.add(raw.receivable_id);
    if (typeof raw.receivable_key === "string") representedReceivables.add(raw.receivable_key);
  }
  if (!snapshotHasBanorte && legacyBanorteComponents > 0) {
    entriesMap.set("banorte", (entriesMap.get("banorte") ?? 0) + legacyBanorteComponents);
  }

  if (pendingItems.length === 0 && isRecord(bank?.pending_collections)) {
    const collectionKeys = new Set(Object.keys(bank.pending_collections).map((key) => key.toLowerCase()));
    let legacyCollectionBanorte = 0;
    for (const [channel, value] of Object.entries(bank.pending_collections)) {
      if (hasOpenReceivables && channel.toLowerCase() === "cxc") continue;
      const amount = amountOf(value);
      const normalizedChannel = normalizeOutstandingChannel(channel);
      if (channel.toLowerCase() === "debito" || channel.toLowerCase() === "credito") {
        if (!collectionKeys.has("banorte")) legacyCollectionBanorte += amount;
        continue;
      }
      if (amount > 0 && isOutstandingChannel(normalizedChannel)) {
        entriesMap.set(normalizedChannel, (entriesMap.get(normalizedChannel) ?? 0) + amount);
      }
    }
    if (!collectionKeys.has("banorte") && legacyCollectionBanorte > 0) {
      entriesMap.set("banorte", (entriesMap.get("banorte") ?? 0) + legacyCollectionBanorte);
    }
  }

  // A bank snapshot closes the ledger only through its own date. Add Corte
  // channels from newer days so the card remains current without using the
  // CxC lifecycle table as a duplicate sales ledger.
  const newerRunsByDate = new Map<string, RunLike[]>();
  for (const run of runs) {
    if (!run.business_date || run.business_date <= asOfDate || run.business_date > throughDate) continue;
    const items = newerRunsByDate.get(run.business_date) ?? [];
    items.push(run);
    newerRunsByDate.set(run.business_date, items);
  }
  for (const dayRuns of newerRunsByDate.values()) {
    const run = dayRuns.sort(compareRunQuality)[0];
    for (const [channel, amount] of Object.entries(pendingChannelsFromRun(run))) {
      if (amount > 0) entriesMap.set(channel, (entriesMap.get(channel) ?? 0) + amount);
    }
  }

  for (const rec of receivables) {
    if (rec.status !== "open") continue;
    if (!isCanonicalCxcReceivable(rec) || (rec.opened_on && rec.opened_on > throughDate)) continue;
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

export type DailyOutstandingSnapshot = OutstandingSnapshot & {
  businessDate: string;
  processedOn: string;
};

export type BankValidationState = "validated" | "review" | "pending_upload" | "not_validated";

/** Read bank validation from the selected day's own payload, never globally. */
export function bankValidationState(run: RunLike): BankValidationState {
  const payload = run.output_payload ?? {};
  const explicit = String(payload.bank_validation_status ?? "").toLowerCase();
  const bank = isRecord(payload.bank_reconciliation)
    ? payload.bank_reconciliation
    : isRecord(payload.bank_stage) && isRecord(payload.bank_stage.bank_reconciliation)
      ? payload.bank_stage.bank_reconciliation
      : null;

  if (explicit === "bank_pending_upload" || run.status === "waiting_for_input") {
    return "pending_upload";
  }
  // Bank validation means the bank batch was processed for this day; pending
  // money is shown separately in the daily outstanding card.
  if (explicit === "bank_validated"
    || String(bank?.status ?? "").toLowerCase() === "bank_validated"
    || bank
    || isRecord(payload.bank_processing_snapshot)) {
    return "validated";
  }
  return "not_validated";
}

export function hasBankValidationForRun(run: RunLike) {
  return bankValidationState(run) === "validated";
}

type BankSnapshotDetails = {
  run: RunLike;
  bank: Record<string, unknown>;
  processedOn: string;
  processedDates: Set<string>;
  pendingItems: Record<string, unknown>[];
  entries: Array<{ channel: string; amount: number }>;
  perDay: Record<string, unknown> | null;
  perDayEntries: Record<string, unknown> | null;
};

function collectBankMatchDates(value: unknown, dates: Set<string>) {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (!isRecord(item)) continue;
    const date = String(item.business_date ?? item.source_date ?? "");
    if (date) dates.add(date);
  }
}

function pendingEntriesFromSnapshot(bank: Record<string, unknown>, items: Record<string, unknown>[]) {
  const entriesMap = new Map<string, number>();
  const pendingCollections = isRecord(bank.pending_collections) ? bank.pending_collections : null;
  const source = pendingCollections ? Object.entries(pendingCollections) : items.map((item) => [String(item.channel ?? "unclassified"), item.amount ?? item.expected_deposit] as const);
  const hasBanorteKey = source.some(([channel]) => channel.toLowerCase() === "banorte");
  let legacyBanorte = 0;

  for (const [channelRaw, rawAmount] of source) {
    const channelKey = channelRaw.toLowerCase();
    const amount = amountOf(rawAmount);
    if (amount <= 0) continue;
    if (["debito", "credito", "terminal", "terminal_banorte"].includes(channelKey)) {
      legacyBanorte += amount;
      continue;
    }
    const channel = normalizeOutstandingChannel(channelRaw);
    if (!isOutstandingChannel(channel)) continue;
    entriesMap.set(channel, (entriesMap.get(channel) ?? 0) + amount);
  }

  if (!hasBanorteKey && legacyBanorte > 0) {
    entriesMap.set("banorte", (entriesMap.get("banorte") ?? 0) + legacyBanorte);
  }

  return Array.from(entriesMap.entries())
    .map(([channel, amount]) => ({ channel, amount: Math.round(amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount || a.channel.localeCompare(b.channel));
}

function bankSnapshotDetails(run: RunLike): BankSnapshotDetails | null {
  const payload = run.output_payload ?? {};
  const direct = isRecord(payload.bank_reconciliation) ? payload.bank_reconciliation : null;
  const stage = isRecord(payload.bank_stage) ? payload.bank_stage : null;
  const nested = stage && isRecord(stage.bank_reconciliation) ? stage.bank_reconciliation : null;
  const bank = direct ?? nested;
  if (!bank) return null;

  const savedSnapshot = isRecord(payload.bank_processing_snapshot) ? payload.bank_processing_snapshot : null;
  const perDay = isRecord(payload.falta_por_entrar_por_dia)
    ? payload.falta_por_entrar_por_dia
    : savedSnapshot && isRecord(savedSnapshot.falta_por_entrar_por_dia)
      ? savedSnapshot.falta_por_entrar_por_dia
      : null;
  const perDayEntries = isRecord(payload.falta_por_entrar_detalle_por_dia)
    ? payload.falta_por_entrar_detalle_por_dia
    : savedSnapshot && isRecord(savedSnapshot.falta_por_entrar_detalle_por_dia)
      ? savedSnapshot.falta_por_entrar_detalle_por_dia
      : null;
  const processedOn = String(savedSnapshot?.processed_on ?? run.business_date ?? "");
  const processedDates = new Set<string>(perDay ? Object.keys(perDay) : []);
  const savedDates = savedSnapshot?.processed_dates;
  if (Array.isArray(savedDates)) {
    for (const date of savedDates) {
      if (typeof date === "string" && date) processedDates.add(date);
    }
  }

  const rawPendingItems = Array.isArray(bank.pending_items) ? bank.pending_items : [];
  const pendingItems = rawPendingItems.filter(isRecord);
  for (const item of pendingItems) {
    const date = String(item.business_date ?? item.source_date ?? "");
    if (date) processedDates.add(date);
  }
  const matches = [
    ...(Array.isArray(bank.matches) ? bank.matches : []),
    ...(Array.isArray(bank.amex_matches) ? bank.amex_matches : []),
  ];
  for (const match of matches) {
    if (!isRecord(match)) continue;
    collectBankMatchDates(match.expected, processedDates);
    collectBankMatchDates(match.expected_group, processedDates);
    collectBankMatchDates(match.allocations, processedDates);
  }

  return {
    run,
    bank,
    processedOn,
    processedDates,
    pendingItems,
    entries: pendingEntriesFromSnapshot(bank, pendingItems),
    perDay,
    perDayEntries,
  };
}

/**
 * Return the cumulative outstanding state attached to one business day. The
 * earliest bank snapshot on or after the day wins; this preserves a day's
 * historical state while allowing several days to share one later processing
 * batch.
 */
export function getOutstandingForDate(runs: RunLike[], businessDate: string): DailyOutstandingSnapshot | null {
  if (!businessDate) return null;
  const candidates = runs
    .map(bankSnapshotDetails)
    .filter((snapshot): snapshot is BankSnapshotDetails => Boolean(snapshot && snapshot.processedOn >= businessDate && snapshot.processedDates.has(businessDate)))
    .sort((a, b) => {
      const aExact = a.processedOn === businessDate ? 0 : 1;
      const bExact = b.processedOn === businessDate ? 0 : 1;
      return aExact - bExact
        || a.processedOn.localeCompare(b.processedOn)
        || a.run.created_at.localeCompare(b.run.created_at);
    });
  const snapshot = candidates[0];
  if (!snapshot) return null;

  const hasPerDayValue = Boolean(snapshot.perDay && Object.prototype.hasOwnProperty.call(snapshot.perDay, businessDate));
  const perDayTotal = hasPerDayValue ? amountOf(snapshot.perDay?.[businessDate]) : null;
  const rawPerDayEntries = snapshot.perDayEntries?.[businessDate];
  const perDayEntries = isRecord(rawPerDayEntries)
    ? pendingEntriesFromSnapshot({ pending_collections: rawPerDayEntries }, [])
    : null;
  const globalTotal = snapshot.entries.reduce((sum, entry) => sum + entry.amount, 0);
  const entries = perDayEntries
    ?? (hasPerDayValue
      ? Math.abs((perDayTotal ?? 0) - globalTotal) < 0.01
        ? [...snapshot.entries]
        : (perDayTotal ?? 0) > 0 ? [{ channel: "total", amount: perDayTotal ?? 0 }] : []
      : [...snapshot.entries]);
  const total = perDayTotal ?? entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (total > 0 && entries.length === 0) entries.push({ channel: "total", amount: total });

  return {
    businessDate,
    processedOn: snapshot.processedOn,
    asOfDate: snapshot.processedOn,
    entries,
    total,
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
  const status = typeof item?.status === "string" ? item.status : "";

  if (status === "fuera_de_rango") {
    return `${channel}_fuera_de_rango`;
  }
  if (key === "amex_neto_pendiente" || key === "amex_bruto_sin_reporte") return "amex";
  if (key === "banorte_terminal_pendiente") return "banorte";
  if (key === "amex") {
    return "amex";
  }
  if (key === "banorte") {
    return "banorte";
  }

  if (key === "uber_eats" || key === "ubereats") return "uber";
  if (key === "cxc") return "CXC";
  if (["amex", "banorte", "uber", "rappi", "paypal", "transferencia", "debito", "credito"].includes(key)) return key;
  const description = item?.description ?? item?.receivable_key;
  return typeof description === "string" && description ? `Otros (${description})` : `Otros (${channel})`;
}

function normalizeReceivableChannel(rec: CorteReceivableLike) {
  const description = typeof rec.evidence?.description === "string"
    ? rec.evidence.description.trim()
    : null;
  return description ? `CXC — ${description}` : "CXC";
}

function isCanonicalCxcReceivable(rec: CorteReceivableLike) {
  return rec.evidence?.kind !== "channel_sales";
}

function isOutstandingChannel(channel: string) {
  return channel === "amex"
    || channel === "banorte"
    || channel === "uber"
    || channel === "rappi"
    || channel === "CXC"
    || channel.startsWith("CXC — ");
}

function pendingChannelsFromRun(run: RunLike) {
  const payload = run.output_payload ?? {};
  const daily = isRecord(payload.daily_record) ? payload.daily_record : null;
  const register = isRecord(payload.income_register)
    ? payload.income_register
    : isRecord(payload.income_channels)
      ? payload.income_channels
      : null;
  const source = daily ?? register;
  if (!source) return {};
  return {
    amex: amountOf(source.amex),
    banorte: amountOf(source.debito) + amountOf(source.credito),
    uber: amountOf(source.uber_eats ?? source.uber),
    rappi: amountOf(source.rappi),
  };
}

function compareRunQuality(a: RunLike, b: RunLike) {
  return scoreRun(b) - scoreRun(a) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

function scoreRun(run: RunLike) {
  let score = 0;
  // Only an explicit bank-validated state should outrank the selected day's
  // stage; `stage=bank_validated` was historically left behind on pending runs.
  if (bankValidationState(run) === "validated") score += 200;
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
