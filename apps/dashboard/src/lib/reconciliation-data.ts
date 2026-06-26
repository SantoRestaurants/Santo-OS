import "server-only";

import { createSupabaseServerClient, createSupabaseServiceClient, getSupabasePublicConfig } from "@/lib/supabase/server";
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

export type ReconciliationData = {
  status: ReconciliationStatus;
  missingConfig: string[];
  error: string | null;
  runs: ReconciliationRun[];
  forecastDocuments: ForecastDocument[];
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

export async function getReconciliationData(skipAuth: boolean = false): Promise<ReconciliationData> {
  const config = getSupabasePublicConfig();
  if (!config.configured) {
    return { status: "requires_config", missingConfig: config.missing, error: null, runs: [], forecastDocuments: [] };
  }

  const supabase = skipAuth ? createSupabaseServiceClient() : await createSupabaseServerClient();
  if (!supabase) {
    return { status: "requires_config", missingConfig: config.missing, error: null, runs: [], forecastDocuments: [] };
  }

  if (!skipAuth) {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { status: "auth_required", missingConfig: [], error: null, runs: [], forecastDocuments: [] };
    }

    const role = user.app_metadata?.role;
    if (role !== "supervisor") {
      // Falback to people table if app_metadata is not yet set
      const { data: person } = await supabase.from("people").select("role_key").eq("email", user.email).single();
      if (!person || person.role_key !== "supervisor") {
        return { status: "unauthorized", missingConfig: [], error: null, runs: [], forecastDocuments: [] };
      }
    }
  }

  const runsResult = await supabase
    .from("workflow_runs")
    .select("id,business_date,status,source_channel,requires_review_reason,created_at,output_payload")
    .eq("source_channel", "agent_mail")
    .order("business_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (runsResult.error) {
    return { status: "query_failed", missingConfig: [], error: runsResult.error.message, runs: [], forecastDocuments: [] };
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
      runs: [],
      forecastDocuments: (forecastResult.data ?? []) as ForecastDocument[],
    };
  }

  try {
    var [emailsResult, documentsResult, reviewsResult, exceptionsResult, forecastResult] = await Promise.all([
      supabase
        .from("email_messages")
        .select("workflow_run_id,from_address,subject,received_at,processing_status")
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
      supabase
        .from("documents")
        .select("id,document_key,document_type,source_system,status,created_at,metadata")
        .is("workflow_run_id", null)
        .eq("document_type", "forecast_workbook")
        .order("created_at", { ascending: false }),
    ]);
  } catch (err) {
    return {
      status: "query_failed",
      missingConfig: [],
      error: err instanceof Error ? err.message : "query_failed",
      runs: [],
      forecastDocuments: [],
    };
  }

  const firstError =
    emailsResult.error ||
    documentsResult.error ||
    reviewsResult.error ||
    exceptionsResult.error;

  if (firstError) {
    return { status: "query_failed", missingConfig: [], error: firstError.message, runs: [], forecastDocuments: [] };
  }

  const emailsByRun = groupByRunId(emailsResult.data ?? []);
  const documentsByRun = groupByRunId(documentsResult.data ?? []);
  const documentsByDate = groupByDocumentDate(documentsResult.data ?? []);
  const reviewsByRun = groupByRunId(reviewsResult.data ?? []);
  const exceptionsByRun = groupByRunId(exceptionsResult.data ?? []);

  return {
    status: "ready",
    missingConfig: [],
    error: null,
    runs: runs.map((run) => {
      const linkedDocs = documentsByRun.get(run.id) ?? [];
      const dateDocs = run.business_date ? documentsByDate.get(run.business_date) ?? [] : [];
      return {
        ...run,
        revision: extractRevisionDocument({ ...run, business_date: run.business_date ?? "" }),
        email: firstForRun(emailsByRun, run.id) as ReconciliationRun["email"],
        documents: dedupeDocuments([...linkedDocs, ...dateDocs]) as ReconciliationRun["documents"],
        reviews: (reviewsByRun.get(run.id) ?? []) as ReconciliationRun["reviews"],
        exceptions: (exceptionsByRun.get(run.id) ?? []) as ReconciliationRun["exceptions"],
      };
    }),
    forecastDocuments: (forecastResult.data ?? []) as ForecastDocument[],
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
