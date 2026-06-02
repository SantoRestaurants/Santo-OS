"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

const CORTE_WORKFLOW_KEY = "corte_santo_daily_sales_reconciliation";
const DEMO_DATE = "2026-06-02";
const DEMO_RUN_IDEMPOTENCY_KEY = "demo:corte_santo:intake:2026-06-02";

function nowIso() {
  return new Date().toISOString();
}

function redirectWithSimulationStatus(status: string): never {
  redirect(`/?demo=1&simulation=${encodeURIComponent(status)}`);
}

async function requireWorkflowId() {
  const userClient = await createSupabaseServerClient();

  if (!userClient) {
    redirectWithSimulationStatus("missing_public_supabase_config");
  }

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    redirectWithSimulationStatus("auth_required");
  }

  const supabase = createSupabaseServiceClient();

  if (!supabase) {
    redirectWithSimulationStatus("missing_service_config");
  }

  const { data: workflow, error } = await supabase
    .from("workflows")
    .select("id")
    .eq("workflow_key", CORTE_WORKFLOW_KEY)
    .maybeSingle();

  if (error || !workflow) {
    redirectWithSimulationStatus("missing_corte_workflow_seed");
  }

  return { supabase, workflowId: workflow.id as string };
}

export async function simulateCorteSantoIntake() {
  const { supabase, workflowId } = await requireWorkflowId();
  const timestamp = nowIso();

  const { data: run, error: runError } = await supabase
    .from("workflow_runs")
    .upsert(
      {
        workflow_id: workflowId,
        business_date: DEMO_DATE,
        status: "requires_review",
        source_channel: "dashboard",
        idempotency_key: DEMO_RUN_IDEMPOTENCY_KEY,
        input_payload: {
          demo: true,
          workflow_key: CORTE_WORKFLOW_KEY,
          restaurant_key: "DEMO_RESTAURANT",
          documents: [
            {
              document_key: "demo_corte_pdf",
              filename: "demo_corte_santo_2026-06-02.pdf",
              source_hash: "demo-corte-pdf-2026-06-02",
            },
            {
              document_key: "demo_bank_csv",
              filename: "demo_bank_movements_2026-06-02.csv",
              source_hash: "demo-bank-csv-2026-06-02",
            },
          ],
        },
        config_snapshot: {
          thresholds: "[CONFIRM]",
          mandatory_attachments: "[CONFIRM]",
          reviewer_map: "[CONFIRM]",
          drive_folder_map: "[CONFIRM]",
        },
        output_payload: {
          demo: true,
          message: "Synthetic Corte Santo intake created by dashboard simulation.",
        },
        requires_review_reason:
          "Demo intake: thresholds, reviewer_map, mandatory_attachments and drive_folder_map require Santo confirmation.",
      },
      { onConflict: "workflow_id,idempotency_key" }
    )
    .select("id")
    .single();

  if (runError || !run) {
    redirectWithSimulationStatus("workflow_run_write_failed");
  }

  const workflowRunId = run.id as string;

  await Promise.all([
    supabase.from("documents").delete().eq("workflow_run_id", workflowRunId),
    supabase.from("watchdog_log").delete().eq("workflow_run_id", workflowRunId),
    supabase
      .from("events")
      .delete()
      .eq("aggregate_type", "workflow_run")
      .eq("aggregate_id", workflowRunId),
  ]);

  const { error: emailError } = await supabase.from("email_messages").upsert(
    {
      provider: "gmail_demo",
      provider_message_id: "demo-corte-santo-2026-06-02",
      internet_message_id: "demo-corte-santo-2026-06-02@santo.local",
      inbox_address: "os-demo@santo.com",
      from_address: "gerencia-demo@santo.com",
      to_addresses: ["os-demo@santo.com"],
      cc_addresses: [],
      subject: "[CORTE] Corte Santo 2026-06-02 - demo",
      received_at: timestamp,
      processing_status: "classified",
      classification_key: "[CORTE]",
      workflow_id: workflowId,
      workflow_run_id: workflowRunId,
      raw_metadata: {
        demo: true,
        attachments: ["demo_corte_santo_2026-06-02.pdf", "demo_bank_movements_2026-06-02.csv"],
      },
    },
    { onConflict: "provider,provider_message_id" }
  );

  if (emailError) {
    redirectWithSimulationStatus("email_message_write_failed");
  }

  const writeResults = await Promise.all([
    supabase.from("documents").insert([
      {
        workflow_run_id: workflowRunId,
        document_key: "demo_corte_pdf",
        document_type: "corte_pdf",
        source_system: "dashboard_upload",
        source_hash: "demo-corte-pdf-2026-06-02",
        status: "requires_review",
        metadata: {
          demo: true,
          filename: "demo_corte_santo_2026-06-02.pdf",
          reason: "Demo file. Real Drive/file source is pending.",
        },
      },
      {
        workflow_run_id: workflowRunId,
        document_key: "demo_bank_csv",
        document_type: "bank_movements",
        source_system: "dashboard_upload",
        source_hash: "demo-bank-csv-2026-06-02",
        status: "requires_review",
        metadata: {
          demo: true,
          filename: "demo_bank_movements_2026-06-02.csv",
          reason: "Demo file. Real source hash rules are pending.",
        },
      },
    ]),
    supabase.from("tasks").upsert(
      [
        {
          workflow_run_id: workflowRunId,
          task_key: "demo_review_corte_intake",
          title: "Review demo Corte Santo intake",
          status: "requires_review",
          metadata: {
            demo: true,
            missing: ["thresholds", "reviewer_map", "mandatory_attachments", "drive_folder_map"],
          },
        },
        {
          workflow_run_id: workflowRunId,
          task_key: "demo_confirm_operational_config",
          title: "Confirm operational config before real reconciliation",
          status: "requires_review",
          metadata: {
            demo: true,
            note: "Real Corte reconciliation remains blocked until Santo confirms rules.",
          },
        },
      ],
      { onConflict: "workflow_run_id,task_key" }
    ),
    supabase.from("exceptions").upsert(
      [
        {
          workflow_run_id: workflowRunId,
          exception_key: "demo_missing_corte_config",
          exception_type: "missing_corte_operational_config",
          severity: "medium",
          status: "requires_review",
          details: {
            demo: true,
            missing: ["thresholds", "reviewer_map", "mandatory_attachments", "drive_folder_map"],
          },
        },
        {
          workflow_run_id: workflowRunId,
          exception_key: "demo_agent_mail_not_connected",
          exception_type: "agent_mail_not_connected",
          severity: "medium",
          status: "requires_review",
          details: {
            demo: true,
            reason: "Agent Mail/Gmail connector is not configured yet.",
          },
        },
      ],
      { onConflict: "workflow_run_id,exception_key" }
    ),
    supabase.from("reviews").upsert(
      [
        {
          workflow_run_id: workflowRunId,
          review_key: "demo_review_corte_intake",
          status: "requires_review",
          metadata: {
            demo: true,
            reason: "Human review needed before real Corte reconciliation.",
          },
        },
        {
          workflow_run_id: workflowRunId,
          review_key: "demo_confirm_agent_mail_setup",
          status: "requires_review",
          metadata: {
            demo: true,
            reason: "Agent Mail/Gmail inbox setup is pending.",
          },
        },
      ],
      { onConflict: "workflow_run_id,review_key" }
    ),
    supabase.from("watchdog_log").insert([
      {
        workflow_id: workflowId,
        workflow_run_id: workflowRunId,
        check_key: "demo.corte_santo_intake",
        severity: "warning",
        status: "requires_review",
        message: "Demo Corte Santo intake requires review before real execution.",
        metadata: {
          demo: true,
        },
      },
    ]),
    supabase.from("events").insert([
      {
        aggregate_type: "workflow_run",
        aggregate_id: workflowRunId,
        event_type: "demo.workflow_run.simulated",
        severity: "info",
        payload: {
          demo: true,
          workflow_key: CORTE_WORKFLOW_KEY,
        },
      },
      {
        aggregate_type: "workflow_run",
        aggregate_id: workflowRunId,
        event_type: "workflow_run.requires_review",
        severity: "warning",
        payload: {
          demo: true,
          reason:
            "Operational configuration is missing; simulation must not become completed.",
        },
      },
    ]),
  ]);

  if (writeResults.some((result) => result.error)) {
    redirectWithSimulationStatus("child_records_write_failed");
  }

  revalidatePath("/");
  redirect("/?simulation=created");
}
