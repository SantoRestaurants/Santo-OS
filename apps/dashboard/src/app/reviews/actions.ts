"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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

export async function rejectReview(formData: FormData) {
    const reviewId = formData.get("reviewId") as string;
    const notes = (formData.get("notes") as string) || null;

    const supabase = await createSupabaseServerClient();
    if (!supabase) redirect("/auth/sign-in");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in");

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

    revalidatePath("/reviews");
    revalidatePath("/");
    redirect("/reviews?success=changes_requested");
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
