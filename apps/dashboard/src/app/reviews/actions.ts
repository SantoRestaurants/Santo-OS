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
