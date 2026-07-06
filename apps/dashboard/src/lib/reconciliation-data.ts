import "server-only";

import { createSupabaseServerClient, getSupabasePublicConfig } from "@/lib/supabase/server";
import { extractDateFromDocument } from "@/lib/corte-dashboard-utils";
import { extractRevisionDocument, type RevisionDocument } from "@/lib/corte-data";

export type ReconciliationStatus = "ready" | "requires_config" | "auth_required" | "unauthorized" | "query_failed";

export type ReconciliationRun = {
  id: string;
  business_date: string | null;
  status: string;
  source_channel: string;
  requires_review_reason: string | null;
  created_at: string;
  output_payload: Record<string, unknown>;
  revision: RevisionDocument | null;
  email: {
    from_address: string;
    subject: string | null;
    received_at: string;
    processing_status: string;
    raw_metadata: Record<string, unknown>;
  } | null;
  documents: Array<{
    id: string;
    document_key: string;
    document_type: string;
    source_system: string;
    source_uri: string | null;
    drive_file_id: string | null;
    status: string;
    created_at: string;
    metadata: Record<string, unknown>;
    view_url?: string | null;
  }>;
  reviews: Array<{
    id: string;
    review_key: string;
    status: string;
    requested_at: string;
    completed_at: string | null;
    review_notes: string | null;
  }>;
  exceptions: Array<{
    id: string;
    exception_key: string;
    exception_type: string;
    severity: string;
    status: string;
    created_at: string;
  }>;
};

export type ForecastDocument = {
  id: string;
  document_key: string;
  document_type: string;
  source_system: string;
  status: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

export type CorteDailyRecord = {
  id: string;
  restaurant_id: string;
  business_date: string;
  amex: number;
  debito: number;
  credito: number;
  efectivo: number;
  transferencia: number;
  total: number;
  paypal: number;
  uber_eats: number;
  rappi: number;
  propinas: number;
  venta_bruta: number | null;
  total_bruto: number | null;
  forecast_target: number | null;
  source_kind: string;
  source_workflow_run_id: string | null;
  parser_version: string;
  restaurants?: { restaurant_key?: string; display_name?: string } | null;
};

export type ReconciliationData = {
  status: ReconciliationStatus;
  missingConfig: string[];
  error: string | null;
  runs: ReconciliationRun[];
  forecastDocuments: ForecastDocument[];
  dailyRecords: CorteDailyRecord[];
};

type RunRow = {
  id: string;
  business_date: string | null;
  status: string;
  source_channel: string;
  requires_review_reason: string | null;
  created_at: string;
  output_payload: Record<string, unknown>;
};

const APPROVAL_REVIEW_KEY = "corte_agent_mail_supervisor_approval";

export { APPROVAL_REVIEW_KEY };

export async function getReconciliationData(allowedRoles: readonly string[] = ["supervisor"]): Promise<ReconciliationData> {
  const config = getSupabasePublicConfig();
  if (!config.configured) {
    return { status: "requires_config", missingConfig: config.missing, error: null, runs: [], forecastDocuments: [], dailyRecords: [] };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "requires_config", missingConfig: config.missing, error: null, runs: [], forecastDocuments: [], dailyRecords: [] };
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { status: "auth_required", missingConfig: [], error: null, runs: [], forecastDocuments: [], dailyRecords: [] };
  }

  let role = typeof user.app_metadata?.role === "string" ? user.app_metadata.role : null;
  if (!role && user.email) {
    const { data: person } = await supabase.from("people").select("role_key").eq("email", user.email).maybeSingle();
    role = person?.role_key ?? null;
  }
  if (!role || !allowedRoles.includes(role)) {
    return { status: "unauthorized", missingConfig: [], error: null, runs: [], forecastDocuments: [], dailyRecords: [] };
  }

  const runsResult = await supabase
    .from("workflow_runs")
    .select("id,business_date,status,source_channel,requires_review_reason,created_at,output_payload")
    .eq("source_channel", "agent_mail")
    .order("business_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (runsResult.error) {
    return { status: "query_failed", missingConfig: [], error: runsResult.error.message, runs: [], forecastDocuments: [], dailyRecords: [] };
  }

  let dailyRecords: CorteDailyRecord[] = [];
  try {
    const result = await supabase
      .from("corte_daily_records")
      .select("id,restaurant_id,business_date,amex,debito,credito,efectivo,transferencia,total,paypal,uber_eats,rappi,propinas,venta_bruta,total_bruto,forecast_target,source_kind,source_workflow_run_id,parser_version,restaurants(restaurant_key,display_name)")
      .order("business_date", { ascending: false })
      .limit(1000);
    if (!result.error) dailyRecords = (result.data ?? []) as unknown as CorteDailyRecord[];
  } catch {
    // Canonical table is introduced with a compatibility window.
  }

  const runs = (runsResult.data ?? []) as RunRow[];
  const runIds = runs.map((run) => run.id);

  if (runIds.length === 0) {
    // Still fetch forecast documents even without runs
    const forecastResult = await supabase
      .from("documents")
      .select("id,document_key,document_type,source_system,status,created_at,metadata")
      .is("workflow_run_id", null)
      .eq("document_type", "forecast_workbook")
      .order("created_at", { ascending: false });
    
    return {
      status: "ready",
      missingConfig: [],
      error: null,
      runs: dailyRecords.map(dailyRecordAsRun),
      forecastDocuments: (forecastResult.data ?? []) as ForecastDocument[],
      dailyRecords,
    };
  }

  const queries = [
    supabase
      .from("email_messages")
      .select("workflow_run_id,from_address,subject,received_at,processing_status,raw_metadata")
      .in("workflow_run_id", runIds)
      .order("received_at", { ascending: false }),
    supabase
      .from("documents")
      .select("id,workflow_run_id,document_key,document_type,source_system,source_uri,drive_file_id,status,created_at,metadata,workflow_runs(business_date)")
      .or(`workflow_run_id.in.(${runIds.join(",")}),workflow_run_id.is.null`)
      .order("created_at", { ascending: false }),
    supabase
      .from("reviews")
      .select("id,workflow_run_id,review_key,status,requested_at,completed_at,review_notes")
      .in("workflow_run_id", runIds)
      .order("requested_at", { ascending: false }),
    supabase
      .from("exceptions")
      .select("id,workflow_run_id,exception_key,exception_type,severity,status,created_at")
      .in("workflow_run_id", runIds)
      .order("created_at", { ascending: false }),
  ] as const;

  const [emailsResult, documentsResult, reviewsResult, exceptionsResult] = await Promise.all(queries);

  let forecastResult: any = { data: [], error: null };
  try {
    forecastResult = await supabase
      .from("documents")
      .select("id,document_key,document_type,source_system,status,created_at,metadata")
      .is("workflow_run_id", null)
      .eq("document_type", "forecast_workbook")
      .order("created_at", { ascending: false });
  } catch {
    // Forecast documents are optional, failure is non-fatal
  }

  const firstError =
    emailsResult.error ||
    documentsResult.error ||
    reviewsResult.error ||
    exceptionsResult.error;

  if (firstError) {
    return { status: "query_failed", missingConfig: [], error: firstError.message, runs: [], forecastDocuments: [], dailyRecords };
  }

  const emailsByRun = groupByRunId(emailsResult.data ?? []);
  const documentsByRun = groupByRunId(documentsResult.data ?? []);
  const documentsByDate = groupByDocumentDate(documentsResult.data ?? []);
  const reviewsByRun = groupByRunId(reviewsResult.data ?? []);
  const exceptionsByRun = groupByRunId(exceptionsResult.data ?? []);

  const hydratedRuns: ReconciliationRun[] = runs.map((run) => {
      const daily = dailyRecords.find((record) => record.source_workflow_run_id === run.id)
        ?? dailyRecords.find((record) => record.business_date === run.business_date);
      const linkedDocs = documentsByRun.get(run.id) ?? [];
      const dateDocs = run.business_date ? documentsByDate.get(run.business_date) ?? [] : [];
      let rev = extractRevisionDocument({ ...run, business_date: run.business_date ?? "" });
      if (!rev) {
        const op = run.output_payload as Record<string, any> | undefined;
        const rawRev = op?.revision_document as Record<string, any> | undefined;
        if (rawRev) rev = rawRev as any;
      }
      const rawOp = run.output_payload as Record<string, any> | undefined;
      const rawRevDoc = rawOp?.revision_document as Record<string, any> | undefined;
      if (rawRevDoc?.falta_por_entrar && !rev?.falta_por_entrar && rev) {
        (rev as any).falta_por_entrar = rawRevDoc.falta_por_entrar;
      }
      return {
        ...run,
        output_payload: daily ? {
          ...run.output_payload,
          daily_record: daily,
          income_register: dailyIncomeRegister(daily),
        } : run.output_payload,
        revision: rev,
        email: firstForRun(emailsByRun, run.id) as ReconciliationRun["email"],
        documents: dedupeDocuments([...linkedDocs, ...dateDocs]) as ReconciliationRun["documents"],
        reviews: (reviewsByRun.get(run.id) ?? []) as ReconciliationRun["reviews"],
        exceptions: (exceptionsByRun.get(run.id) ?? []) as ReconciliationRun["exceptions"],
      };
    });

  const runDates = new Set(hydratedRuns.map((run) => run.business_date));
  for (const daily of dailyRecords) {
    if (runDates.has(daily.business_date)) continue;
    hydratedRuns.push(dailyRecordAsRun(daily));
  }

  return {
    status: "ready",
    missingConfig: [],
    error: null,
    runs: hydratedRuns,
    forecastDocuments: (forecastResult.data ?? []) as ForecastDocument[],
    dailyRecords,
  };
}

function dailyIncomeRegister(record: CorteDailyRecord) {
  return {
    amex: record.amex,
    debito: record.debito,
    credito: record.credito,
    efectivo: record.efectivo,
    transferencia: record.transferencia,
    paypal: record.paypal,
    uber: record.uber_eats,
    rappi: record.rappi,
    propinas: record.propinas,
  };
}

function dailyRecordAsRun(record: CorteDailyRecord): ReconciliationRun {
  const storedUnit = record.restaurants?.restaurant_key ?? record.restaurants?.display_name;
  const unit = !storedUnit || storedUnit === "default_restaurant_confirm" || storedUnit === "[CONFIRM] First P0 restaurant/unit"
    ? "SANTO"
    : storedUnit;
  return {
    id: `daily:${record.id}`,
    business_date: record.business_date,
    status: "completed",
    source_channel: "system",
    requires_review_reason: null,
    created_at: `${record.business_date}T00:00:00Z`,
    output_payload: { daily_record: record, income_register: dailyIncomeRegister(record) },
    revision: { unidad: unit, restaurant_key: unit, business_date: record.business_date },
    email: null,
    documents: [],
    reviews: [],
    exceptions: [],
  };
}

function groupByRunId<T extends { workflow_run_id?: string | null }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.workflow_run_id) continue;
    const current = grouped.get(row.workflow_run_id) ?? [];
    current.push(row);
    grouped.set(row.workflow_run_id, current);
  }
  return grouped;
}

function firstForRun<T>(grouped: Map<string, T[]>, runId: string) {
  return (grouped.get(runId) ?? [null])[0];
}

function groupByDocumentDate<T extends { workflow_run_id?: string | null }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    if (row.workflow_run_id) continue;
    const date = extractDateFromDocument(row as unknown as ReconciliationRun["documents"][number]);
    if (!date) continue;
    const current = grouped.get(date) ?? [];
    current.push(row);
    grouped.set(date, current);
  }
  return grouped;
}

function dedupeDocuments<T extends { id: string }>(docs: T[]) {
  const seen = new Set<string>();
  return docs.filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
}
