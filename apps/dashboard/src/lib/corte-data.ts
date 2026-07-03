import "server-only";

import { createSupabaseServerClient, getSupabasePublicConfig } from "@/lib/supabase/server";

export type CorteDetail = {
  id: string;
  business_date: string;
  status: string;
  source_channel: string;
  requires_review_reason: string | null;
  created_at: string;
  output_payload: Record<string, unknown>;
};

export type RevisionDocument = {
  unidad?: string;
  restaurant_key?: string;
  business_date?: string;
  vta_por_dia?: Array<{
    dia: string;
    fecha: string;
    meta_vta: number;
    venta_real: number;
    diferencia: number;
  }>;
  vta_al_dia?: {
    meta_vta: number;
    venta_real: number;
    diferencia: number;
    pct_diferencia: number | null;
  };
  vta_meta_mes?: {
    meta_vta: number;
    venta_real: number;
    diferencia: number;
  };
  formato_corte?: string;
  saldos?: {
    prov_aguinaldos: number;
    saldo_banorte: number;
    prov_utilidades: number;
    total: number;
  };
  gastos_adicionales?: Array<{
    concepto: string;
    importe: number;
    observaciones: string | null;
  }>;
  falta_por_entrar?: Record<string, number>;
  ajustes_del_dia?: Array<{
    concepto: string;
    importe: number;
    observaciones: string | null;
  }>;
  reconciliation_totals?: {
    total_real: number;
    total_sistema: number;
    difference: number;
    tolerance: number;
  };
  daily_financial_record?: {
    venta_bruta: number;
    total_bruto: number;
    parser_version?: string;
  };
};

export type CorteListResult = {
  status: string;
  cortes: CorteDetail[];
  error: string | null;
};

export async function getCorteList(): Promise<CorteListResult> {
  const config = getSupabasePublicConfig();
  if (!config.configured) {
    return { status: "requires_config", cortes: [], error: null };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "requires_config", cortes: [], error: null };
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { status: "auth_required", cortes: [], error: null };
  }

  const { data, error } = await supabase
    .from("workflow_runs")
    .select("id,business_date,status,source_channel,requires_review_reason,created_at,output_payload")
    .eq("source_channel", "agent_mail")
    .order("business_date", { ascending: false })
    .limit(30);

  if (error) {
    return { status: "query_failed", cortes: [], error: error.message };
  }

  return { status: "ready", cortes: (data as CorteDetail[]) ?? [], error: null };
}

export async function getCorteById(id: string): Promise<{ status: string; corte: CorteDetail | null; error: string | null }> {
  const config = getSupabasePublicConfig();
  if (!config.configured) {
    return { status: "requires_config", corte: null, error: null };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "requires_config", corte: null, error: null };
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { status: "auth_required", corte: null, error: null };
  }

  const { data, error } = await supabase
    .from("workflow_runs")
    .select("id,business_date,status,source_channel,requires_review_reason,created_at,output_payload")
    .eq("id", id)
    .single();

  if (error) {
    return { status: "query_failed", corte: null, error: error.message };
  }

  return { status: "ready", corte: data as CorteDetail, error: null };
}

export function extractRevisionDocument(corte: CorteDetail): RevisionDocument | null {
  const payload = corte.output_payload;
  if (!payload || typeof payload !== "object") return null;

  // Direct path (from agent-mail and bank-watcher output)
  if (payload.revision_document && typeof payload.revision_document === "object") {
    return payload.revision_document as RevisionDocument;
  }

  // Nested in workflow_run
  const workflowRun = payload.workflow_run as Record<string, unknown> | undefined;
  if (workflowRun && typeof workflowRun === "object" && workflowRun.revision_document && typeof workflowRun.revision_document === "object") {
    return workflowRun.revision_document as RevisionDocument;
  }

  // Nested in corte_santo_initial_stage (from agent-mail output)
  const stage = payload.corte_santo_initial_stage as Record<string, unknown> | undefined;
  if (stage && typeof stage === "object") {
    const wr = (stage.workflow_result as Record<string, unknown> | undefined)?.workflow_run as Record<string, unknown> | undefined;
    if (wr && wr.revision_document && typeof wr.revision_document === "object") {
      return wr.revision_document as RevisionDocument;
    }
  }

  // Recursive search as fallback
  return findRevisionDocumentRecursive(payload);
}

function findRevisionDocumentRecursive(obj: unknown): RevisionDocument | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  if (record.revision_document && typeof record.revision_document === "object") {
    return record.revision_document as RevisionDocument;
  }
  for (const value of Object.values(record)) {
    const found = findRevisionDocumentRecursive(value);
    if (found) return found;
  }
  return null;
}
