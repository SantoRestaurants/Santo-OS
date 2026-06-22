import "server-only";

import { createSupabaseServerClient, getSupabasePublicConfig } from "@/lib/supabase/server";
import { extractRevisionDocument, type RevisionDocument } from "@/lib/corte-data";

export type ReconciliationStatus = "ready" | "requires_config" | "auth_required" | "query_failed";

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
    document_type: string;
    source_system: string;
    source_uri: string | null;
    drive_file_id: string | null;
    status: string;
    created_at: string;
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

export type ReconciliationData = {
  status: ReconciliationStatus;
  missingConfig: string[];
  error: string | null;
  runs: ReconciliationRun[];
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

export async function getReconciliationData(): Promise<ReconciliationData> {
  const config = getSupabasePublicConfig();
  if (!config.configured) {
    return { status: "requires_config", missingConfig: config.missing, error: null, runs: [] };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "requires_config", missingConfig: config.missing, error: null, runs: [] };
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { status: "auth_required", missingConfig: [], error: null, runs: [] };
  }

  const runsResult = await supabase
    .from("workflow_runs")
    .select("id,business_date,status,source_channel,requires_review_reason,created_at,output_payload")
    .eq("source_channel", "agent_mail")
    .order("business_date", { ascending: false })
    .limit(12);

  if (runsResult.error) {
    return { status: "query_failed", missingConfig: [], error: runsResult.error.message, runs: [] };
  }

  const runs = (runsResult.data ?? []) as RunRow[];
  const runIds = runs.map((run) => run.id);

  if (runIds.length === 0) {
    return { status: "ready", missingConfig: [], error: null, runs: [] };
  }

  const [emailsResult, documentsResult, reviewsResult, exceptionsResult] = await Promise.all([
    supabase
      .from("email_messages")
      .select("workflow_run_id,from_address,subject,received_at,processing_status")
      .in("workflow_run_id", runIds)
      .order("received_at", { ascending: false }),
    supabase
      .from("documents")
      .select("id,workflow_run_id,document_type,source_system,source_uri,drive_file_id,status,created_at")
      .in("workflow_run_id", runIds)
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
  ]);

  const firstError =
    emailsResult.error ||
    documentsResult.error ||
    reviewsResult.error ||
    exceptionsResult.error;

  if (firstError) {
    return { status: "query_failed", missingConfig: [], error: firstError.message, runs: [] };
  }

  const emailsByRun = groupByRunId(emailsResult.data ?? []);
  const documentsByRun = groupByRunId(documentsResult.data ?? []);
  const reviewsByRun = groupByRunId(reviewsResult.data ?? []);
  const exceptionsByRun = groupByRunId(exceptionsResult.data ?? []);

  return {
    status: "ready",
    missingConfig: [],
    error: null,
    runs: runs.map((run) => ({
      ...run,
      revision: extractRevisionDocument({ ...run, business_date: run.business_date ?? "" }),
      email: firstForRun(emailsByRun, run.id) as ReconciliationRun["email"],
      documents: (documentsByRun.get(run.id) ?? []) as ReconciliationRun["documents"],
      reviews: (reviewsByRun.get(run.id) ?? []) as ReconciliationRun["reviews"],
      exceptions: (exceptionsByRun.get(run.id) ?? []) as ReconciliationRun["exceptions"],
    })),
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
