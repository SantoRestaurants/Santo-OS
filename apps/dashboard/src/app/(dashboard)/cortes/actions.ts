"use server";

import crypto from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

async function requireAuth(returnTo: string) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/auth/sign-in");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const serviceClient = createSupabaseServiceClient();
  if (!serviceClient) redirect(withQuery(returnTo, "error", "service_client_not_configured"));

  return { user, serviceClient };
}

export async function saveCorteComment(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId") || "");
  const comment = String(formData.get("comment") || "").trim();
  const returnTo = safeReturnTo(String(formData.get("returnTo") || "/cortes"));
  const { user, serviceClient } = await requireAuth(returnTo);

  if (!workflowRunId) redirect(withQuery(returnTo, "error", "workflow_run_missing"));
  if (!comment) redirect(withQuery(returnTo, "error", "comment_missing"));

  const { data: run, error } = await serviceClient
    .from("workflow_runs")
    .select("output_payload")
    .eq("id", workflowRunId)
    .single();

  if (error || !run) redirect(withQuery(returnTo, "error", error?.message ?? "workflow_run_not_found"));

  const payload = ((run as { output_payload?: Record<string, unknown> }).output_payload ?? {}) as Record<string, unknown>;
  const comments = Array.isArray(payload.dashboard_comments) ? payload.dashboard_comments : [];
  payload.dashboard_comments = [
    ...comments,
    {
      comment,
      created_at: new Date().toISOString(),
      created_by_email: user.email ?? null,
      channel: "dashboard",
    },
  ];

  const { error: updateError } = await serviceClient
    .from("workflow_runs")
    .update({ output_payload: payload })
    .eq("id", workflowRunId);

  if (updateError) redirect(withQuery(returnTo, "error", updateError.message));

  await serviceClient.from("events").insert({
    aggregate_type: "workflow_run",
    aggregate_id: workflowRunId,
    event_type: "corte.dashboard_comment_added",
    severity: "info",
    payload: { comment, created_by_email: user.email ?? null },
  });

  revalidatePath("/cortes");
  redirect(withQuery(returnTo, "success", "comment_saved"));
}

export async function saveManualCorrection(formData: FormData) {
  const workflowRunId = String(formData.get("workflowRunId") || "");
  const field = String(formData.get("field") || "").trim();
  const valueRaw = String(formData.get("value") || "").trim();
  const note = String(formData.get("note") || "").trim();
  const returnTo = safeReturnTo(String(formData.get("returnTo") || "/cortes"));
  const { user, serviceClient } = await requireAuth(returnTo);

  if (!workflowRunId) redirect(withQuery(returnTo, "error", "workflow_run_missing"));
  if (!field || !valueRaw) redirect(withQuery(returnTo, "error", "manual_correction_missing"));
  const value = Number(valueRaw);
  if (!Number.isFinite(value)) redirect(withQuery(returnTo, "error", "manual_correction_value_invalid"));

  const { data: run, error } = await serviceClient
    .from("workflow_runs")
    .select("output_payload")
    .eq("id", workflowRunId)
    .single();

  if (error || !run) redirect(withQuery(returnTo, "error", error?.message ?? "workflow_run_not_found"));

  const payload = ((run as { output_payload?: Record<string, unknown> }).output_payload ?? {}) as Record<string, unknown>;
  const corrections = Array.isArray(payload.dashboard_manual_corrections) ? payload.dashboard_manual_corrections : [];
  payload.dashboard_manual_corrections = [
    ...corrections,
    {
      field,
      value,
      note,
      created_at: new Date().toISOString(),
      created_by_email: user.email ?? null,
    },
  ];

  setNestedRevisionValue(payload, field, value);

  const { error: updateError } = await serviceClient
    .from("workflow_runs")
    .update({ output_payload: payload, status: "requires_review", requires_review_reason: "manual_dashboard_correction" })
    .eq("id", workflowRunId);

  if (updateError) redirect(withQuery(returnTo, "error", updateError.message));

  await serviceClient.from("events").insert({
    aggregate_type: "workflow_run",
    aggregate_id: workflowRunId,
    event_type: "corte.manual_value_corrected",
    severity: "warning",
    payload: { field, value, note, created_by_email: user.email ?? null },
  });

  revalidatePath("/cortes");
  redirect(withQuery(returnTo, "success", "manual_correction_saved"));
}

export async function uploadForecast(formData: FormData) {
  const month = String(formData.get("month") || "");
  const file = formData.get("forecastFile");
  const returnTo = safeReturnTo(String(formData.get("returnTo") || "/archivos"));
  const { user, serviceClient } = await requireAuth(returnTo);

  if (!month) redirect(withQuery(returnTo, "error", "forecast_month_missing"));
  if (!(file instanceof File) || file.size === 0) redirect(withQuery(returnTo, "error", "forecast_file_missing"));

  const folderId = process.env.CORTE_SANTO_DRIVE_FOLDER_ID || process.env.CORTE_SANTO_BANK_UPLOAD_FOLDER_ID;
  if (!folderId || folderId.includes("[CONFIRM]")) {
    redirect(withQuery(returnTo, "error", "forecast_drive_folder_missing"));
  }

  let uploaded: Awaited<ReturnType<typeof uploadToDrive>>;
  try {
    const token = await getDriveAccessToken();
    uploaded = await uploadToDrive({
      accessToken: token,
      folderId,
      file,
      driveName: `${month} SANTO Forecast ${sanitizeFilename(file.name || "forecast.xlsx")}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "forecast_upload_failed";
    redirect(withQuery(returnTo, "error", message));
  }

  const sourceHash = uploaded.sourceHash;
  const { data: existing } = await serviceClient
    .from("documents")
    .select("id")
    .is("workflow_run_id", null)
    .eq("document_type", "forecast_workbook")
    .eq("source_hash", sourceHash)
    .limit(1);

  const row = {
    workflow_run_id: null,
    document_key: `forecast:${month}:${sourceHash.slice(0, 12)}`,
    document_type: "forecast_workbook",
    source_system: "drive",
    source_uri: uploaded.webViewLink ?? null,
    drive_file_id: uploaded.id,
    source_hash: sourceHash,
    status: "registered",
    metadata: {
      month,
      uploaded_from: "dashboard",
      uploaded_by_email: user.email ?? null,
      name: uploaded.name,
      size: file.size,
      mime_type: uploaded.mimeType ?? file.type,
    },
  };

  if (existing?.[0]?.id) {
    await serviceClient.from("documents").update(row).eq("id", existing[0].id);
  } else {
    await serviceClient.from("documents").insert(row);
  }

  await serviceClient.from("events").insert({
    aggregate_type: "document",
    aggregate_id: uploaded.id,
    event_type: "forecast.uploaded",
    severity: "info",
    payload: { month, uploaded_by_email: user.email ?? null, drive_file_id: uploaded.id },
  });

  revalidatePath("/archivos");
  revalidatePath("/cortes");
  redirect(withQuery(returnTo, "success", "forecast_uploaded"));
}

function setNestedRevisionValue(payload: Record<string, unknown>, field: string, value: number) {
  const parts = field.split(".").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => !/^[a-zA-Z0-9_]+$/.test(part))) return;

  // Handle income_register and income_channels at the payload level
  if (parts[0] === "income_register" || parts[0] === "income_channels") {
    let target: Record<string, unknown> = payload;
    for (const part of parts.slice(0, -1)) {
      const next = target[part];
      if (!next || typeof next !== "object" || Array.isArray(next)) target[part] = {};
      target = target[part] as Record<string, unknown>;
    }
    target[parts[parts.length - 1]] = value;
    return;
  }

  // Handle revision_document fields
  const revision = getRevisionContainer(payload);
  if (!revision) return;
  let target: Record<string, unknown> = revision;
  for (const part of parts.slice(0, -1)) {
    const next = target[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) target[part] = {};
    target = target[part] as Record<string, unknown>;
  }
  target[parts[parts.length - 1]] = value;
}

function getRevisionContainer(payload: Record<string, unknown>) {
  if (payload.revision_document && typeof payload.revision_document === "object") {
    return payload.revision_document as Record<string, unknown>;
  }
  const stage = payload.corte_santo_initial_stage as Record<string, unknown> | undefined;
  const workflowResult = stage?.workflow_result as Record<string, unknown> | undefined;
  const workflowRun = workflowResult?.workflow_run as Record<string, unknown> | undefined;
  if (workflowRun?.revision_document && typeof workflowRun.revision_document === "object") {
    return workflowRun.revision_document as Record<string, unknown>;
  }
  return null;
}

async function getDriveAccessToken() {
  const required = ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"];
  for (const name of required) {
    const value = process.env[name];
    if (!value || value.includes("[CONFIRM]")) throw new Error(`${name.toLowerCase()}_missing`);
  }
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
  if (!response.ok) throw new Error(`drive_token_failed:${response.status}`);
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("drive_token_missing");
  return data.access_token;
}

async function uploadToDrive({
  accessToken,
  folderId,
  file,
  driveName,
}: {
  accessToken: string;
  folderId: string;
  file: File;
  driveName: string;
}) {
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
  if (!response.ok) throw new Error(`drive_upload_failed:${response.status}:${(await response.text()).slice(0, 160)}`);
  const data = await response.json() as { id: string; name: string; webViewLink?: string; mimeType?: string };
  return {
    ...data,
    sourceHash: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function sanitizeFilename(value: string) {
  return value.replace(/[^\w.\- ]+/g, "_").slice(0, 140);
}

function safeReturnTo(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/cortes";
  return value;
}

function withQuery(path: string, key: "success" | "error", value: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(value)}`;
}
