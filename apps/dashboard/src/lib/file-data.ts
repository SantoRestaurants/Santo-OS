import "server-only";

import { createSupabaseServerClient, getSupabasePublicConfig } from "@/lib/supabase/server";
import { driveUrl } from "@/lib/corte-dashboard-utils";

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

  const [documentsResult, runsResult] = await Promise.all([
    supabase
      .from("documents")
      .select("id,workflow_run_id,document_key,document_type,source_system,source_uri,drive_file_id,status,created_at,metadata,workflow_runs(business_date)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("workflow_runs")
      .select("id,business_date,created_at,output_payload")
      .eq("source_channel", "agent_mail")
      .order("business_date", { ascending: false })
      .limit(120),
  ]);

  const error = documentsResult.error || runsResult.error;
  if (error) {
    return { status: "query_failed", missingConfig: [], error: error.message, documents: [] };
  }

  return {
    status: "ready",
    missingConfig: [],
    error: null,
    documents: dedupeDocuments([
      ...normalizeDocuments(documentsResult.data ?? []),
      ...documentsFromRuns(runsResult.data ?? []),
    ]),
  };
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

function documentsFromRuns(rows: unknown[]): DriveDocument[] {
  const docs: DriveDocument[] = [];
  for (const row of rows) {
    const run = row as {
      id: string;
      business_date: string | null;
      created_at: string;
      output_payload?: Record<string, unknown>;
    };
    const payload = run.output_payload ?? {};
    const driveIds = isRecord(payload.drive_file_ids) ? payload.drive_file_ids : {};

    if (typeof driveIds.forecast === "string" && driveIds.forecast) {
      docs.push(syntheticDoc(run, "forecast_workbook", "Forecast mensual", driveIds.forecast, run.business_date?.slice(0, 7)));
    }
    if (typeof driveIds.ingresos === "string" && driveIds.ingresos) {
      docs.push(syntheticDoc(run, "income_workbook", "Excel mensual de ingresos", driveIds.ingresos, run.business_date?.slice(0, 7)));
    }
    if (typeof driveIds.folder_id === "string" && driveIds.folder_id) {
      docs.push(syntheticFolder(run, "daily_folder", "Carpeta de evidencia (Drive)", driveIds.folder_id, run.business_date?.slice(0, 7)));
    }
  }
  return docs;
}

function syntheticFolder(
  run: { id: string; business_date: string | null; created_at: string },
  documentType: string,
  name: string,
  driveFolderId: string,
  month?: string,
): DriveDocument {
  return {
    id: `synthetic:${documentType}:${driveFolderId}:${month ?? "unknown"}`,
    workflow_run_id: run.id,
    document_key: `${documentType}:${month ?? run.business_date ?? driveFolderId}`,
    document_type: documentType,
    source_system: "workflow_payload",
    source_uri: `https://drive.google.com/drive/folders/${driveFolderId}`,
    drive_file_id: driveFolderId,
    status: "registered",
    created_at: run.created_at,
    metadata: { name, month },
    workflow_runs: { business_date: run.business_date },
  };
}

function syntheticDoc(
  run: { id: string; business_date: string | null; created_at: string },
  documentType: string,
  name: string,
  driveFileId: string,
  month?: string,
): DriveDocument {
  return {
    id: `synthetic:${documentType}:${driveFileId}:${month ?? "unknown"}`,
    workflow_run_id: run.id,
    document_key: `${documentType}:${month ?? run.business_date ?? driveFileId}`,
    document_type: documentType,
    source_system: "workflow_payload",
    source_uri: driveUrl(driveFileId),
    drive_file_id: driveFileId,
    status: "registered",
    created_at: run.created_at,
    metadata: { name, month },
    workflow_runs: { business_date: run.business_date },
  };
}

function dedupeDocuments(docs: DriveDocument[]) {
  const seen = new Set<string>();
  return docs.filter((doc) => {
    const key = doc.drive_file_id ? `${doc.document_type}:${doc.drive_file_id}` : doc.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
