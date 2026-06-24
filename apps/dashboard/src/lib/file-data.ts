import "server-only";

import { createSupabaseServerClient, getSupabasePublicConfig } from "@/lib/supabase/server";

export type DriveDocument = {
  id: string;
  workflow_run_id: string | null;
  document_key: string;
  document_type: string;
  source_system: string;
  source_uri: string | null;
  drive_file_id: string | null;
  status: string;
  created_at: string;
  metadata: Record<string, unknown>;
  workflow_runs?: { business_date: string | null } | Array<{ business_date: string | null }> | null;
};

export type FileData = {
  status: "ready" | "requires_config" | "auth_required" | "query_failed";
  missingConfig: string[];
  error: string | null;
  documents: DriveDocument[];
};

export async function getFileData(): Promise<FileData> {
  const config = getSupabasePublicConfig();
  if (!config.configured) {
    return { status: "requires_config", missingConfig: config.missing, error: null, documents: [] };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "requires_config", missingConfig: config.missing, error: null, documents: [] };
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { status: "auth_required", missingConfig: [], error: null, documents: [] };
  }

  const { data, error } = await supabase
    .from("documents")
    .select("id,workflow_run_id,document_key,document_type,source_system,source_uri,drive_file_id,status,created_at,metadata,workflow_runs(business_date)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return { status: "query_failed", missingConfig: [], error: error.message, documents: [] };
  }

  return { status: "ready", missingConfig: [], error: null, documents: normalizeDocuments(data ?? []) };
}

function normalizeDocuments(rows: unknown[]): DriveDocument[] {
  return rows.map((row) => {
    const record = row as DriveDocument;
    const relation = record.workflow_runs;
    return {
      ...record,
      workflow_runs: Array.isArray(relation) ? relation[0] ?? null : relation ?? null,
    };
  });
}
