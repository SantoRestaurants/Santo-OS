"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const AGENTMAIL_API_KEY = process.env.AGENTMAIL_API_KEY || "";
const AGENTMAIL_INBOX_ID = process.env.AGENTMAIL_INBOX_ID || "santoos@agentmail.to";

async function sendCorrectionEmail(to: string, subject: string, notes: string) {
    if (!AGENTMAIL_API_KEY) return; // Skip if not configured

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
        // Email send is best-effort, don't block the review action
    }
}

export async function approveReview(formData: FormData) {
    const reviewId = formData.get("reviewId") as string;
    const notes = (formData.get("notes") as string) || null;

    const supabase = await createSupabaseServerClient();
    if (!supabase) redirect("/auth/sign-in");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in");

    const { error } = await supabase
        .from("reviews")
        .update({
            status: "approved",
            review_notes: notes,
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
    const notes = (formData.get("notes") as string) || "Se requieren correcciones.";
    const originalFrom = (formData.get("originalFrom") as string) || "";
    const originalSubject = (formData.get("originalSubject") as string) || "Operación";

    const supabase = await createSupabaseServerClient();
    if (!supabase) redirect("/auth/sign-in");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in");

    // Update review status
    const { error } = await supabase
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

    // Send correction email back to the original sender
    if (originalFrom) {
        await sendCorrectionEmail(originalFrom, originalSubject, notes);
    }

    revalidatePath("/reviews");
    revalidatePath("/");
    redirect("/reviews?success=correction_sent");
}

export async function resolveException(formData: FormData) {
    const exceptionId = formData.get("exceptionId") as string;
    const notes = (formData.get("notes") as string) || null;

    const supabase = await createSupabaseServerClient();
    if (!supabase) redirect("/auth/sign-in");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in");

    const { error } = await supabase
        .from("exceptions")
        .update({
            status: "resolved",
            details: { resolved_notes: notes, resolved_by: user.email },
        })
        .eq("id", exceptionId);

    if (error) {
        redirect(`/reviews?error=${encodeURIComponent(error.message)}`);
    }

    revalidatePath("/reviews");
    revalidatePath("/");
    redirect("/reviews?success=resolved");
}
