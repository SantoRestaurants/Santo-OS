"use server";

import crypto from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { APPROVAL_REVIEW_KEY } from "@/lib/reconciliation-data";

const REPO = process.env.GITHUB_REPOSITORY || "SantoRestaurants/Santo-OS";

type ServiceClient = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;

async function requireAuth() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/auth/sign-in");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) redirect("/conciliacion?error=service_client_not_configured");

  return { user, serviceClient };
}

export async function approveAgentMailStage(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId") || "");
  const notes = String(formData.get("notes") || "Aprobado por supervisora desde dashboard").trim();
  const returnTo = safeReturnTo(String(formData.get("returnTo") || "/conciliacion"));
  const { user, serviceClient } = await requireAuth();

  if (!workflowRunId) redirect(withQuery(returnTo, "error", "workflow_run_missing"));

  const { data: review, error: reviewError } = await serviceClient
    .from("reviews")
    .upsert(
      {
        workflow_run_id: workflowRunId,
        review_key: APPROVAL_REVIEW_KEY,
        status: "approved",
        completed_at: new Date().toISOString(),
        review_notes: notes || "Aprobado",
        metadata: {
          channel: "dashboard",
          approved_by_email: user.email,
          gate: "agent_mail_before_bank_upload",
        },
      },
      { onConflict: "workflow_run_id,review_key" },
    )
    .select("id")
    .single();

  if (reviewError || !review) {
    redirect(`/conciliacion?error=${encodeURIComponent(reviewError?.message ?? "review_upsert_failed")}`);
  }

  await serviceClient.from("approvals").insert({
    review_id: review.id,
    status: "approved",
    decision_notes: notes || "Aprobado",
    decided_at: new Date().toISOString(),
    metadata: { approved_by_email: user.email, channel: "dashboard" },
  });

  await serviceClient
    .from("workflow_runs")
    .update({ status: "waiting_for_input", requires_review_reason: null })
    .eq("id", workflowRunId);

  await serviceClient.from("events").insert({
    aggregate_type: "workflow_run",
    aggregate_id: workflowRunId,
    event_type: "corte.agent_mail_stage_approved",
    severity: "info",
    payload: { approved_by_email: user.email, notes },
  });

  revalidatePath("/conciliacion");
  revalidatePath("/cortes");
  revalidatePath("/");
  redirect(withQuery(returnTo, "success", "agent_mail_approved"));
}

export async function uploadBankFilesAndTrigger(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId") || "");
  const businessDate = String(formData.get("businessDate") || "");
  const amexFile = formData.get("amexFile");
  const banorteFile = formData.get("banorteFile");
  const returnTo = safeReturnTo(String(formData.get("returnTo") || "/conciliacion"));
  const { user, serviceClient } = await requireAuth();

  if (!workflowRunId || !businessDate) redirect(withQuery(returnTo, "error", "workflow_run_missing"));
  if (!(amexFile instanceof File) || amexFile.size === 0) redirect(withQuery(returnTo, "error", "amex_file_missing"));
  if (!(banorteFile instanceof File) || banorteFile.size === 0) redirect(withQuery(returnTo, "error", "banorte_file_missing"));

  const approved = await hasSupervisorApproval(serviceClient, workflowRunId);
  if (!approved) {
    redirect(withQuery(returnTo, "error", "agent_mail_stage_not_approved"));
  }

  const folderId = process.env.CORTE_SANTO_DRIVE_FOLDER_ID || process.env.CORTE_SANTO_BANK_UPLOAD_FOLDER_ID;

  const missingDriveConfig = missingConfirmed([
    "GOOGLE_DRIVE_CLIENT_ID",
    "GOOGLE_DRIVE_CLIENT_SECRET",
    "GOOGLE_DRIVE_REFRESH_TOKEN",
  ]);
  
  if (!folderId || folderId.includes("[CONFIRM]")) {
    missingDriveConfig.push("CORTE_SANTO_DRIVE_FOLDER_ID");
  }

  if (missingDriveConfig.length > 0) {
    await markUploadBlocked(serviceClient, workflowRunId, user.email ?? null, {
      reason: "dashboard_bank_upload_drive_config_missing",
      missing: missingDriveConfig,
    });
    redirect(withQuery(returnTo, "error", `Falta config de Drive: ${missingDriveConfig.join(", ")}`));
  }

  let uploads: Array<Awaited<ReturnType<typeof uploadToDrive>>>;
  try {
    const token = await getDriveAccessToken();
    uploads = await Promise.all([
      uploadToDrive({
        accessToken: token,
        folderId: folderId,
        file: amexFile,
        documentType: "amex_statement",
        businessDate,
      }),
      uploadToDrive({
        accessToken: token,
        folderId: folderId,
        file: banorteFile,
        documentType: "banorte_statement",
        businessDate,
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "drive_upload_failed";
    await markUploadBlocked(serviceClient, workflowRunId, user.email ?? null, {
      reason: "dashboard_bank_upload_drive_failed",
      error: message,
    });
    redirect(withQuery(returnTo, "error", `No pude subir a Drive: ${message}`));
  }

  for (const uploaded of uploads) {
    await registerDocument(serviceClient, workflowRunId, uploaded, user.email ?? null);
  }

  await serviceClient.from("events").insert({
    aggregate_type: "workflow_run",
    aggregate_id: workflowRunId,
    event_type: "corte.bank_files_uploaded",
    severity: "info",
    payload: {
      uploaded_by_email: user.email,
      business_date: businessDate,
      documents: uploads.map((upload) => ({
        document_type: upload.documentType,
        drive_file_id: upload.id,
        name: upload.name,
      })),
    },
  });

  const trigger = await triggerBankWatcher(businessDate);
  if (!trigger.ok) {
    await markUploadBlocked(serviceClient, workflowRunId, user.email ?? null, {
      reason: "bank_watcher_trigger_failed",
      trigger_error: trigger.error,
    });
    redirect(withQuery(returnTo, "error", `Archivos subidos, pero no pude disparar bank-watcher: ${trigger.error}`));
  }

  revalidatePath("/conciliacion");
  revalidatePath("/cortes");
  redirect(withQuery(returnTo, "success", "bank_watcher_triggered"));
}

async function hasSupervisorApproval(serviceClient: ServiceClient, workflowRunId: string) {
  const { data } = await serviceClient
    .from("reviews")
    .select("id")
    .eq("workflow_run_id", workflowRunId)
    .eq("review_key", APPROVAL_REVIEW_KEY)
    .eq("status", "approved")
    .limit(1);
  return Boolean(data?.length);
}

function missingConfirmed(names: string[]) {
  return names.filter((name) => {
    const value = process.env[name];
    return !value || value.includes("[CONFIRM]");
  });
}

async function markUploadBlocked(
  serviceClient: ServiceClient,
  workflowRunId: string,
  userEmail: string | null,
  payload: Record<string, unknown>,
) {
  await serviceClient.from("exceptions").upsert(
    {
      workflow_run_id: workflowRunId,
      exception_key: String(payload.reason ?? "dashboard_bank_upload_blocked"),
      exception_type: "bank_upload",
      severity: "medium",
      status: "requires_review",
      details: { ...payload, user_email: userEmail },
    },
    { onConflict: "workflow_run_id,exception_key" },
  );
  await serviceClient.from("events").insert({
    aggregate_type: "workflow_run",
    aggregate_id: workflowRunId,
    event_type: "corte.bank_upload_requires_review",
    severity: "warning",
    payload: { ...payload, user_email: userEmail },
  });
}

async function getDriveAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_DRIVE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`drive_token_failed:${response.status}`);
  }
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("drive_token_missing");
  return data.access_token;
}

async function uploadToDrive({
  accessToken,
  folderId,
  file,
  documentType,
  businessDate,
}: {
  accessToken: string;
  folderId: string;
  file: File;
  documentType: "amex_statement" | "banorte_statement";
  businessDate: string;
}) {
  const originalName = sanitizeFilename(file.name || `${documentType}.xlsx`);
  const prefix = documentType === "amex_statement" ? "AMEX" : "BANORTE";
  const driveName = `${businessDate} ${prefix} ${originalName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const boundary = `santoos_${crypto.randomBytes(12).toString("hex")}`;
  const metadata = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({
      name: driveName,
      parents: [folderId],
    })}\r\n`,
  );
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--`);

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,modifiedTime",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: Buffer.concat([metadata, fileHeader, buffer, footer]),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`drive_upload_failed:${response.status}:${errorText.slice(0, 180)}`);
  }

  const data = await response.json() as {
    id: string;
    name: string;
    webViewLink?: string;
    mimeType?: string;
    modifiedTime?: string;
  };

  return {
    ...data,
    documentType,
    sourceHash: crypto.createHash("sha256").update(buffer).digest("hex"),
    size: file.size,
    mimeType: data.mimeType ?? file.type,
  };
}

async function registerDocument(
  serviceClient: ServiceClient,
  workflowRunId: string,
  uploaded: Awaited<ReturnType<typeof uploadToDrive>>,
  userEmail: string | null,
) {
  const { data: existing } = await serviceClient
    .from("documents")
    .select("id")
    .eq("workflow_run_id", workflowRunId)
    .eq("source_hash", uploaded.sourceHash)
    .limit(1);

  const row = {
    workflow_run_id: workflowRunId,
    document_key: `${uploaded.documentType}:${uploaded.sourceHash.slice(0, 12)}`,
    document_type: uploaded.documentType,
    source_system: "drive",
    source_uri: uploaded.webViewLink ?? null,
    drive_file_id: uploaded.id,
    source_hash: uploaded.sourceHash,
    status: "registered",
    metadata: {
      uploaded_from: "dashboard",
      uploaded_by_email: userEmail,
      name: uploaded.name,
      size: uploaded.size,
      mime_type: uploaded.mimeType,
      modified_time: uploaded.modifiedTime,
    },
  };

  if (existing?.[0]?.id) {
    await serviceClient.from("documents").update(row).eq("id", existing[0].id);
  } else {
    await serviceClient.from("documents").insert(row);
  }
}

async function triggerBankWatcher(businessDate: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || token.includes("[CONFIRM]")) {
    return { ok: false, error: "github_token_missing" };
  }

  const response = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/corte-santo-bank-watcher.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { business_date: businessDate },
      }),
    },
  );

  if (!response.ok) {
    return { ok: false, error: `${response.status} ${await response.text()}` };
  }
  return { ok: true };
}

function sanitizeFilename(value: string) {
  return value.replace(/[^\w.\- ]+/g, "_").slice(0, 140);
}

function safeReturnTo(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/conciliacion";
  return value;
}

function withQuery(path: string, key: "success" | "error", value: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(value)}`;
}
