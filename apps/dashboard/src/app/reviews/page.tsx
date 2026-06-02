import { AlertTriangle, ArrowLeft, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { approveReview, rejectReview, resolveException } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
    const tones: Record<string, string> = {
        neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
        green: "border-emerald-200 bg-emerald-50 text-emerald-800",
        amber: "border-amber-200 bg-amber-50 text-amber-900",
        red: "border-red-200 bg-red-50 text-red-800",
    };
    return (
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
            {children}
        </span>
    );
}

function humanizeReviewKey(k: string) {
    const map: Record<string, string> = {
        review_corte_intake_config: "Revisar configuración del Corte",
        confirm_agent_mail_routing: "Confirmar reglas de email",
        demo_review_corte_intake: "Revisar intake del Corte",
        demo_confirm_agent_mail_setup: "Confirmar setup de email",
    };
    return map[k] ?? k.replace(/_/g, " ");
}

function humanizeExceptionType(t: string) {
    const map: Record<string, string> = {
        missing_corte_operational_config: "Configuración del Corte pendiente",
        agent_mail_not_connected: "Email no conectado",
        document_requires_review: "Documento necesita revisión",
        cash_difference_above_threshold: "Diferencia de caja fuera de rango",
        missing_mandatory_document: "Falta documento obligatorio",
    };
    return map[t] ?? t.replace(/_/g, " ");
}

export default async function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
    const params = await searchParams;
    const successMsg = typeof params.success === "string" ? params.success : null;
    const errorMsg = typeof params.error === "string" ? params.error : null;

    const supabase = await createSupabaseServerClient();
    if (!supabase) redirect("/auth/sign-in");

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/auth/sign-in");

    const [reviewsResult, exceptionsResult] = await Promise.all([
        supabase
            .from("reviews")
            .select("id,review_key,status,review_notes,requested_at,completed_at,workflow_run_id")
            .order("requested_at", { ascending: false })
            .limit(20),
        supabase
            .from("exceptions")
            .select("id,exception_key,exception_type,severity,status,details,created_at,workflow_run_id")
            .in("status", ["open", "requires_review"])
            .order("created_at", { ascending: false })
            .limit(20),
    ]);

    const reviews = reviewsResult.data ?? [];
    const exceptions = exceptionsResult.data ?? [];
    const pendingReviews = reviews.filter((r) => r.status === "requested" || r.status === "requires_review");
    const completedReviews = reviews.filter((r) => r.status !== "requested" && r.status !== "requires_review");

    return (
        <main className="min-h-screen bg-zinc-50">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
                {/* Header */}
                <header className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Santo AI OS
                        </div>
                        <h1 className="mt-1 text-2xl font-bold text-zinc-900">Revisión y aprobación</h1>
                        <p className="mt-1 text-sm text-zinc-600">
                            Acá se aprueban o rechazan las operaciones que necesitan decisión humana.
                        </p>
                    </div>
                    <Link
                        className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50"
                        href="/"
                    >
                        <ArrowLeft className="h-3 w-3" />
                        Panel
                    </Link>
                </header>

                {/* Feedback banners */}
                {successMsg && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                        {successMsg === "approved" && "✓ Revisión aprobada correctamente."}
                        {successMsg === "changes_requested" && "✓ Se pidieron cambios. El responsable será notificado."}
                        {successMsg === "resolved" && "✓ Excepción marcada como resuelta."}
                    </div>
                )}
                {errorMsg && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        Error: {errorMsg}
                    </div>
                )}

                {/* Pending reviews */}
                <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                    <div className="border-b border-zinc-100 px-5 py-4">
                        <h2 className="text-sm font-semibold text-zinc-900">
                            Pendientes de revisión ({pendingReviews.length})
                        </h2>
                    </div>
                    <div className="divide-y divide-zinc-100">
                        {pendingReviews.length === 0 && (
                            <p className="px-5 py-8 text-center text-sm text-zinc-400">
                                No hay nada pendiente de revisión.
                            </p>
                        )}
                        {pendingReviews.map((review) => (
                            <div key={review.id} className="px-5 py-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-medium text-zinc-900">
                                            {humanizeReviewKey(review.review_key)}
                                        </h3>
                                        <p className="mt-0.5 text-xs text-zinc-500">
                                            Solicitada: {new Date(review.requested_at).toLocaleString("es-MX")}
                                        </p>
                                    </div>
                                    <Badge tone="amber">Pendiente</Badge>
                                </div>
                                <div className="mt-3 flex gap-2">
                                    <form action={approveReview}>
                                        <input type="hidden" name="reviewId" value={review.id} />
                                        <button
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                                            type="submit"
                                        >
                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                            Aprobar
                                        </button>
                                    </form>
                                    <form action={rejectReview}>
                                        <input type="hidden" name="reviewId" value={review.id} />
                                        <input type="hidden" name="notes" value="Requiere correcciones" />
                                        <button
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                                            type="submit"
                                        >
                                            <XCircle className="h-3.5 w-3.5" />
                                            Pedir corrección
                                        </button>
                                    </form>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Open exceptions */}
                <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                    <div className="border-b border-zinc-100 px-5 py-4">
                        <h2 className="text-sm font-semibold text-zinc-900">
                            Excepciones abiertas ({exceptions.length})
                        </h2>
                    </div>
                    <div className="divide-y divide-zinc-100">
                        {exceptions.length === 0 && (
                            <p className="px-5 py-8 text-center text-sm text-zinc-400">
                                Sin excepciones abiertas — todo en orden.
                            </p>
                        )}
                        {exceptions.map((ex) => (
                            <div key={ex.id} className="px-5 py-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-medium text-zinc-900">
                                            {humanizeExceptionType(ex.exception_type)}
                                        </h3>
                                        <p className="mt-0.5 text-xs text-zinc-500">
                                            Severidad: {ex.severity} · {new Date(ex.created_at).toLocaleString("es-MX")}
                                        </p>
                                    </div>
                                    <Badge tone={ex.severity === "high" || ex.severity === "critical" ? "red" : "amber"}>
                                        {ex.severity === "high" || ex.severity === "critical" ? "Alta" : "Media"}
                                    </Badge>
                                </div>
                                <form action={resolveException} className="mt-3">
                                    <input type="hidden" name="exceptionId" value={ex.id} />
                                    <button
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                                        type="submit"
                                    >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        Marcar como resuelta
                                    </button>
                                </form>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Completed reviews */}
                {completedReviews.length > 0 && (
                    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                        <div className="border-b border-zinc-100 px-5 py-4">
                            <h2 className="text-sm font-semibold text-zinc-900">
                                Revisiones completadas ({completedReviews.length})
                            </h2>
                        </div>
                        <div className="divide-y divide-zinc-100">
                            {completedReviews.map((review) => (
                                <div key={review.id} className="px-5 py-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <h3 className="text-sm font-medium text-zinc-900">
                                                {humanizeReviewKey(review.review_key)}
                                            </h3>
                                            <p className="mt-0.5 text-xs text-zinc-500">
                                                {review.review_notes ?? "Sin notas"}
                                            </p>
                                        </div>
                                        <Badge tone={review.status === "approved" ? "green" : "neutral"}>
                                            {review.status === "approved" ? "Aprobada" : review.status === "changes_requested" ? "Correcciones" : review.status}
                                        </Badge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </main>
    );
}
