import { ArrowLeft, CheckCircle2, MessageSquare, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/Badge";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { approveReview, requestCorrection, resolveException } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function humanizeReviewKey(k: string) {
    const map: Record<string, string> = {
        review_corte_intake_config: "Revisar configuración del Corte",
        confirm_agent_mail_routing: "Confirmar reglas de email",
        review_xml_sat_validation: "Revisar Validación XML SAT",
        review_utility_receipts: "Revisar Recibos de Servicios",
    };
    return map[k] ?? k.replace(/_/g, " ");
}

function humanizeExceptionType(t: string) {
    const map: Record<string, string> = {
        missing_corte_operational_config: "Falta configuración del Corte (rangos, revisores, documentos obligatorios)",
        agent_mail_not_connected: "El email del sistema no está conectado a un inbox real",
        document_requires_review: "Un documento necesita ser revisado manualmente",
        cash_difference_above_threshold: "La diferencia de caja supera el rango aceptable",
        missing_mandatory_document: "Falta un documento obligatorio en el corte",
        unclassified_email: "Llegó un email que el sistema no pudo clasificar",
        sender_not_in_allowlist: "Email de un remitente no autorizado",
    };
    return map[t] ?? t.replace(/_/g, " ");
}

function formatDate(iso: string) {
    return new Intl.DateTimeFormat("es-MX", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(iso));
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
            .select("id,review_key,status,review_notes,requested_at,completed_at,workflow_run_id,metadata")
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
        <main className="min-h-screen">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
                {/* Header */}
                <header className="flex items-center justify-between pl-10 lg:pl-0">
                    <div>
                        <div className="flex items-center gap-2 text-xs font-medium text-stone-700">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Santo AI OS
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                            <h1 className="text-2xl font-bold text-stone-900">Mis pendientes</h1>
                            <HelpTooltip
                                text="Aquí están los cortes que necesitan tu decisión. El sistema nunca cierra algo solo si hay dudas: primero te pregunta a ti."
                                position="right"
                            />
                        </div>
                        <p className="mt-1 text-sm text-stone-600">
                            Cortes que necesitan tu aprobación o una corrección.
                        </p>
                    </div>
                    <Link
                        className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-sm hover:bg-stone-50"
                        href="/"
                    >
                        <ArrowLeft className="h-3 w-3" />
                        Inicio
                    </Link>
                </header>

                {/* Feedback */}
                {successMsg && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                        {successMsg === "approved" && "✓ Aprobado. La operación puede continuar."}
                        {successMsg === "correction_sent" && "✓ Corrección enviada por email al remitente original."}
                        {successMsg === "resolved" && "✓ Problema marcado como resuelto."}
                    </div>
                )}
                {errorMsg && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                        Error: {errorMsg}
                    </div>
                )}

                {/* Pending reviews */}
                <section data-tour="pending-reviews" className="rounded-xl border border-stone-200 bg-white shadow-sm">
                    <div className="border-b border-stone-100 px-5 py-4">
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold text-stone-900">
                                Esperando tu decisión ({pendingReviews.length})
                            </h2>
                            <HelpTooltip
                                text="Estas operaciones no pueden avanzar hasta que las apruebes o pidas corrección. El sistema se detiene aquí intencionalmente para que tú tengas el control."
                                position="right"
                            />
                        </div>
                        <p className="mt-0.5 text-xs text-stone-600">
                            Estas operaciones no pueden avanzar hasta que las apruebes o pidas corrección.
                        </p>
                    </div>
                    <div className="divide-y divide-stone-100">
                        {pendingReviews.length === 0 && (
                            <p className="px-5 py-8 text-center text-sm text-stone-600">
                                No hay nada esperando tu decisión.
                            </p>
                        )}
                        {pendingReviews.map((review, index) => (
                            <div key={review.id} className="px-5 py-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-stone-900">
                                            {humanizeReviewKey(review.review_key)}
                                        </h3>
                                        <p className="mt-0.5 text-xs text-stone-600">
                                            {formatDate(review.requested_at)}
                                        </p>
                                    </div>
                                    <Badge tone="amber">Pendiente</Badge>
                                </div>

                                {/* Actions */}
                                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                                    {/* Approve */}
                                    <form action={approveReview} data-tour={index === 0 ? "approve-action" : undefined}>
                                        <input type="hidden" name="reviewId" value={review.id} />
                                        <button
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                                            type="submit"
                                        >
                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                            Aprobar
                                        </button>
                                    </form>

                                    {/* Request correction — with notes field */}
                                    <form action={requestCorrection} className="flex flex-1 items-end gap-2" data-tour={index === 0 ? "correction-action" : undefined}>
                                        <input type="hidden" name="reviewId" value={review.id} />
                                        <input type="hidden" name="originalFrom" value="" />
                                        <input type="hidden" name="originalSubject" value={review.review_key} />
                                        <div className="flex-1">
                                            <input
                                                className="w-full rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-800 placeholder:text-stone-500 focus:border-stone-400 focus:outline-none"
                                                name="notes"
                                                placeholder="Notas de corrección (ej: falta el voucher del banco)"
                                                type="text"
                                            />
                                        </div>
                                        <button
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-4 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                                            type="submit"
                                        >
                                            <MessageSquare className="h-3.5 w-3.5" />
                                            Pedir corrección
                                        </button>
                                    </form>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Exceptions — problems detected by the system */}
                <section data-tour="exceptions-detected" className="rounded-xl border border-stone-200 bg-white shadow-sm">
                    <div className="border-b border-stone-100 px-5 py-4">
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-semibold text-stone-900">
                                Problemas detectados ({exceptions.length})
                            </h2>
                            <HelpTooltip
                                text="El sistema detecta estos problemas automáticamente al procesar operaciones. Puedes resolverlos cuando los hayas atendido, o dejarlos para después."
                                position="right"
                            />
                        </div>
                        <p className="mt-0.5 text-xs text-stone-600">
                            El sistema encontró estos problemas automáticamente. Puedes resolverlos o dejarlos para
                            después.
                        </p>
                    </div>
                    <div className="divide-y divide-stone-100">
                        {exceptions.length === 0 && (
                            <p className="px-5 py-8 text-center text-sm text-stone-600">
                                Sin problemas detectados — todo en orden.
                            </p>
                        )}
                        {exceptions.map((ex) => (
                            <div key={ex.id} className="px-5 py-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-medium text-stone-900">
                                            {humanizeExceptionType(ex.exception_type)}
                                        </h3>
                                        <p className="mt-0.5 text-xs text-stone-600">
                                            {formatDate(ex.created_at)}
                                            {ex.severity === "high" || ex.severity === "critical"
                                                ? " · Prioridad alta"
                                                : ""}
                                        </p>
                                    </div>
                                    <Badge tone={ex.severity === "high" || ex.severity === "critical" ? "red" : "amber"}>
                                        {ex.severity === "high" || ex.severity === "critical" ? "Urgente" : "Revisar"}
                                    </Badge>
                                </div>
                                <form action={resolveException} className="mt-3">
                                    <input type="hidden" name="exceptionId" value={ex.id} />
                                    <button
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50"
                                        type="submit"
                                    >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        Ya lo resolví
                                    </button>
                                </form>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Completed */}
                {completedReviews.length > 0 && (
                    <section data-tour="history" className="rounded-xl border border-stone-200 bg-white shadow-sm">
                        <div className="border-b border-stone-100 px-5 py-4">
                            <h2 className="text-sm font-semibold text-stone-900">
                                Historial ({completedReviews.length})
                            </h2>
                        </div>
                        <div className="divide-y divide-stone-100">
                            {completedReviews.map((review) => (
                                <div key={review.id} className="flex items-center justify-between gap-4 px-5 py-3">
                                    <div>
                                        <span className="text-sm text-stone-700">
                                            {humanizeReviewKey(review.review_key)}
                                        </span>
                                        {review.review_notes && (
                                            <p className="mt-0.5 text-xs text-stone-600">
                                                Notas: {review.review_notes}
                                            </p>
                                        )}
                                    </div>
                                    <Badge tone={review.status === "approved" ? "green" : "neutral"}>
                                        {review.status === "approved"
                                            ? "Aprobada"
                                            : review.status === "changes_requested"
                                                ? "Corrección enviada"
                                                : review.status}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </main>
    );
}
