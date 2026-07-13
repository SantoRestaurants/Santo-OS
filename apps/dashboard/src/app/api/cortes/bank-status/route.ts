import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const workflowRunId = new URL(request.url).searchParams.get("workflowRunId");
  if (!workflowRunId) return NextResponse.json({ error: "workflow_run_missing" }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  const { data, error } = await supabase
    .from("workflow_runs")
    .select("status,output_payload")
    .eq("id", workflowRunId)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const output = (data.output_payload ?? {}) as Record<string, unknown>;
  const bank = (output.bank_reconciliation ?? {}) as Record<string, unknown>;
  const processing = (output.bank_processing ?? null) as Record<string, unknown> | null;
  return NextResponse.json({
    workflow_status: data.status,
    processing: processing ? {
      ...processing,
      bank_status: bank.status,
      pending_collections: bank.pending_collections,
    } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
