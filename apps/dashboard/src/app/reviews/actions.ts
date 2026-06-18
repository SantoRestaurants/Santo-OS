"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY || "";
const AGENTMAIL_INBOX_ID = process.env.AGENTMAIL_INBOX_ID || "santoos@agentmail.to";

async function sendCorrectionEmail(to: string, subject: string, notes: string) {
    if (!AGENTMAIL_API_KEY) return;

    try {
        await fetch(
            `https://api.agentmail.to/v0/inboxes/${AGENTMAIL_INBOX_ID}/messages/send`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${AGENTMAIL_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    to,
                    subject: `[CORRECCIÓN] ${subject}`,
                    text: [
                        "Se requieren correcciones para la siguiente operación:",
                        "",
                        `Asunto original: ${subject}`,
                        "",
                        "Notas del revisor:",
                        notes,
                        "",
                        "Por favor corregí y reenviá.",
                        "",
                        "— Santo AI OS",
                    ].join("\n"),
                }),
            }
        );
    } catch {
        // Email send is best-effort
    }
}

async function requireAuth() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) redirect("/auth/sign-in");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in");

    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) redirect("/reviews?error=service_client_not_configured");

    return { user, serviceClient };
}

export async function approveReview(formData: FormData) {
    const reviewId = formData.get("reviewId") as string;
    const { serviceClient } = await requireAuth();

    const { error } = await serviceClient
        .from("reviews")
        .update({
            status: "approved",
            review_notes: "Aprobado",
            completed_at: new Date().toISOString(),
        })
        .eq("id", reviewId);

    if (error) {
        redirect(`/reviews?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/reviews");
    revalidatePath("/");
    redirect("/reviews?success=approved");
}

export async function requestCorrection(formData: FormData) {
    const reviewId = formData.get("reviewId") as string;
    const notes = (formData.get("notes") as string)?.trim();
    const originalFrom = (formData.get("originalFrom") as string) || "";
    const originalSubject = (formData.get("originalSubject") as string) || "Operación";

    // Notes are required
    if (!notes) {
        redirect("/reviews?error=Escribí qué hay que corregir antes de enviar");
    }

    const { serviceClient } = await requireAuth();

    const { error } = await serviceClient
        .from("reviews")
        .update({
            status: "changes_requested",
            review_notes: notes,
            completed_at: new Date().toISOString(),
        })
        .eq("id", reviewId);

    if (error) {
        redirect(`/reviews?error=${encodeURIComponent(error.message)}`);
    }

    // Send correction email
    if (originalFrom) {
        await sendCorrectionEmail(originalFrom, originalSubject, notes);
    }

    revalidatePath("/reviews");
    revalidatePath("/");
    redirect("/reviews?success=correction_sent");
}

export async function resolveException(formData: FormData) {
    const exceptionId = formData.get("exceptionId") as string;
    const { user, serviceClient } = await requireAuth();

    const { error } = await serviceClient
        .from("exceptions")
        .update({
            status: "resolved",
            details: { resolved_by: user.email, resolved_at: new Date().toISOString() },
        })
        .eq("id", exceptionId);

    if (error) {
        redirect(`/reviews?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/reviews");
    revalidatePath("/");
    redirect("/reviews?success=resolved");
}

export async function correctValue(formData: FormData) {
    const exceptionId = formData.get("exceptionId") as string;
    const workflowRunId = formData.get("workflowRunId") as string;
    const field = formData.get("field") as string;
    const value = formData.get("value") as string;
    const { user, serviceClient } = await requireAuth();

    if (!field || !value) {
        redirect(`/reviews?error=Completá el campo y el valor`);
    }

    // Get the current workflow run
    const { data: run, error: fetchError } = await serviceClient
        .from("workflow_runs")
        .select("output_payload")
        .eq("id", workflowRunId)
        .single();

    if (fetchError || !run) {
        redirect(`/reviews?error=${encodeURIComponent("No se encontró el workflow run")}`);
    }

    // Parse the value as number
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
        redirect(`/reviews?error=El valor debe ser un número`);
    }

    // Update the output_payload with the corrected value
    const payload = (run.output_payload || {}) as Record<string, unknown>;
    const revDoc = (payload.revision_document || {}) as Record<string, unknown>;

    // Handle nested field paths like "vta_al_dia.meta_vta"
    const parts = field.split(".");
    let target: Record<string, unknown> = revDoc;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]] || typeof target[parts[i]] !== "object") {
            target[parts[i]] = {};
        }
        target = target[parts[i]] as Record<string, unknown>;
    }
    target[parts[parts.length - 1]] = numValue;

    // Update the workflow run
    const { error: updateError } = await serviceClient
        .from("workflow_runs")
        .update({ output_payload: payload })
        .eq("id", workflowRunId);

    if (updateError) {
        redirect(`/reviews?error=${encodeURIComponent(updateError.message)}`);
    }

    // Resolve the exception
    await serviceClient
        .from("exceptions")
        .update({
            status: "resolved",
            details: { resolved_by: user.email, resolved_at: new Date().toISOString(), corrected_field: field, corrected_value: numValue },
        })
        .eq("id", exceptionId);

    revalidatePath("/reviews");
    revalidatePath("/cortes");
    redirect("/reviews?success=resolved");
}

export async function retryWorkflow(formData: FormData) {
    const exceptionId = formData.get("exceptionId") as string;
    const workflowRunId = formData.get("workflowRunId") as string;
    const { user, serviceClient } = await requireAuth();

    // Mark exception as acknowledged
    await serviceClient
        .from("exceptions")
        .update({
            status: "acknowledged",
            details: { acknowledged_by: user.email, acknowledged_at: new Date().toISOString() },
        })
        .eq("id", exceptionId);

    // The actual retry happens via GitHub Actions or the scheduler
    // For now, we just mark it and let the user trigger manually

    revalidatePath("/reviews");
    redirect("/reviews?success=resolved");
}

export async function reuploadPhoto(formData: FormData) {
    const exceptionId = formData.get("exceptionId") as string;
    const workflowRunId = formData.get("workflowRunId") as string;
    const documentType = formData.get("documentType") as string;
    const file = formData.get("file") as File;
    const { user, serviceClient } = await requireAuth();

    if (!file || file.size === 0) {
        redirect(`/reviews?error=Seleccioná un archivo`);
    }

    // Read file as base64
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    // Store in Supabase Storage
    const fileName = `reuploads/${workflowRunId}/${documentType}_${Date.now()}_${file.name}`;
    const { data: uploadData, error: uploadError } = await serviceClient.storage
        .from("corte-attachments")
        .upload(fileName, buffer, {
            contentType: file.type,
            upsert: true,
        });

    if (uploadError) {
        redirect(`/reviews?error=${encodeURIComponent("Error al subir: " + uploadError.message)}`);
    }

    // Get public URL
    const { data: urlData } = await serviceClient.storage
        .from("corte-attachments")
        .getPublicUrl(fileName);

    // Update the exception with the reuploaded photo URL
    await serviceClient
        .from("exceptions")
        .update({
            status: "acknowledged",
            details: {
                reuploaded_by: user.email,
                reuploaded_at: new Date().toISOString(),
                document_type: documentType,
                file_url: urlData.publicUrl,
                file_name: file.name,
            },
        })
        .eq("id", exceptionId);

    // Also update the workflow run's documents to include the new file
    if (workflowRunId) {
        const { data: run } = await serviceClient
            .from("workflow_runs")
            .select("output_payload")
            .eq("id", workflowRunId)
            .single();

        if (run) {
            const payload = (run.output_payload || {}) as Record<string, unknown>;
            const docs = (payload.documents || []) as Array<Record<string, unknown>>;
            docs.push({
                document_type: documentType,
                source_path: urlData.publicUrl,
                source_uri: urlData.publicUrl,
                reuploaded: true,
                reuploaded_by: user.email,
            });
            payload.documents = docs;
            await serviceClient
                .from("workflow_runs")
                .update({ output_payload: payload })
                .eq("id", workflowRunId);
        }
    }

    revalidatePath("/reviews");
    redirect("/reviews?success=resolved");
}
