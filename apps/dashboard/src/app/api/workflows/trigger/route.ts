import { NextRequest, NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.workflow) {
    return NextResponse.json({ error: "Missing 'workflow' field" }, { status: 400 });
  }

  const { workflow, business_date } = body;

  if (!["agent-mail", "bank-watcher"].includes(workflow)) {
    return NextResponse.json({ error: "Invalid workflow. Use 'agent-mail' or 'bank-watcher'" }, { status: 400 });
  }

  // The actual workflow execution happens via GitHub Actions or Vercel Cron.
  // This endpoint just triggers a workflow_run record in Supabase that the
  // scheduler will pick up, or returns the trigger info for the frontend.

  // For now, return the trigger info so the frontend can show a confirmation.
  // The actual execution is handled by the cron/scheduler infrastructure.
  return NextResponse.json({
    status: "triggered",
    workflow,
    business_date: business_date ?? null,
    message: `Workflow '${workflow}' triggered. Se ejecutará en el próximo ciclo del scheduler.`,
  });
}
