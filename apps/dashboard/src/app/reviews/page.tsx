import { ArrowLeft, CheckCircle2, MessageSquare, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/Badge";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { approveReview, requestCorrection, resolveException, correctValue, retryWorkflow } from "./actions";

const GOLD = "#C9A84C";
const CREAM = "#E8E0D0";

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
        missing_corte_operational_config: "Falta configuración del Corte",
        agent_mail_not_connected: "El email del sistema no está conectado",
        document_requires_review: "Un documento necesita ser revisado manualmente",
        cash_difference_above_threshold: "La diferencia de caja supera el rango aceptable",
        missing_mandatory_document: "Falta un documento obligatorio en el corte",
        unclassified_email: "Llegó un email que el sistema no pudo clasificar",
        sender_not_in_allowlist: "Email de un remitente no autorizado",
        evidence_requires_review: "La evidencia necesita revisión",
        extraction_requires_review: "La extracción del Excel tuvo problemas",
    };
    return map[t] ?? t.replace(/_/g, " ");
}

function getExceptionHint(exceptionKey: string): string {
    if (exceptionKey.includes("vision_extraction_error")) return "Gemini falló al extraer datos de la foto. Podés reintentar o corregir manualmente.";
    if (exceptionKey.includes("vision_confidence")) return "Gemini no confió en la lectura. Revisá los valores extraídos.";
    if (exceptionKey.includes("photo_vs_excel")) return "La foto no coincide con el Excel. Corregí el valor correcto abajo.";
    if (exceptionKey.includes("requires_review")) return "Hay un problema que necesita tu atención.";
    if (exceptionKey.includes("missing")) return "Falta información. Completá lo que falta.";
    if (exceptionKey.includes("discrepancy")) return "Hay una diferencia que necesita revisión.";
    return "";
}

function getExceptionFields(exceptionKey: string): string[] {
    if (exceptionKey.includes("amex_photo")) return ["amex"];
    if (exceptionKey.includes("bancarias_photo")) return ["bancos"];
    if (exceptionKey.includes("payment_form")) return ["consumo", "propina"];
    if (exceptionKey.includes("total_real")) return ["total_real", "total_sistema"];
    return [];
}

function isRetryable(exceptionKey: string): boolean {
    return exceptionKey.includes("vision_extraction_error") ||
        exceptionKey.includes("vision_confidence") ||
        exceptionKey.includes("drive") ||
        exceptionKey.includes("requires_review");
}

function isCorrectable(exceptionKey: string): boolean {
    return exceptionKey.includes("photo_vs_excel") ||
        exceptionKey.includes("discrepancy") ||
        exceptionKey.includes("payment_form") ||
        exceptionKey.includes("total_real");
}

function formatDate(iso: string) {
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
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
        supabase.from("reviews").select("id,review_key,status,review_notes,requested_at,completed_at,workflow_run_id,metadata").order("requested_at", { ascending: false }).limit(20),
        supabase.from("exceptions").select("id,exception_key,exception_type,severity,status,details,created_at,workflow_run_id").in("status", ["open", "requires_review"]).order("created_at", { ascending: false }).limit(20),
    ]);

    const reviews = reviewsResult.data ?? [];
    const exceptions = exceptionsResult.data ?? [];
    const pendingReviews = reviews.filter((r) => r.status === "requested" || r.status === "requires_review");
    const completedReviews = reviews.filter((r) => r.status !== "requested" && r.status !== "requires_review");

    return (
        <main style={{ minHeight: "100vh" }}>
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
                <header className="flex items-center justify-between pl-10 lg:pl-0">
                    <div>
                        <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "#666" }}>
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Santo AI OS
                        </div>
                        <h1 className="mt-1 text-2xl font-bold" style={{ color: GOLD, letterSpacing: "2px", textTransform: "uppercase" }}>Mis pendientes</h1>
                        <p className="mt-1 text-sm" style={{ color: "#666" }}>Cortes que necesitan tu aprobación o una corrección.</p>
                    </div>
                    <Link className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "#222", background: "#111", color: CREAM }} href="/">
                        <ArrowLeft className="h-3 w-3" /> Inicio
                    </Link>
                </header>

                {successMsg && (
                    <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "#4CAF8244", background: "#4CAF8211", color: "#4CAF82" }}>
                        {successMsg === "approved" && "✓ Aprobado. La operación puede continuar."}
                        {successMsg === "correction_sent" && "✓ Corrección enviada por email al remitente original."}
                        {successMsg === "resolved" && "✓ Problema marcado como resuelto."}
                    </div>
                )}
                {errorMsg && (
                    <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "#E05A5A44", background: "#E05A5A11", color: "#E05A5A" }}>Error: {errorMsg}</div>
                )}

                {/* Pending reviews */}
                <section className="rounded-xl border" style={{ borderColor: "#222", background: "#111" }}>
                    <div className="border-b px-5 py-4" style={{ borderColor: "#1a1a1a" }}>
                        <h2 className="text-sm font-semibold" style={{ color: CREAM }}>Esperando tu decisión ({pendingReviews.length})</h2>
                        <p className="mt-0.5 text-xs" style={{ color: "#666" }}>Estas operaciones no pueden avanzar hasta que las apruebes o pidas corrección.</p>
                    </div>
                    <div className="divide-y" style={{ borderColor: "#1a1a1a" }}>
                        {pendingReviews.length === 0 && <p className="px-5 py-8 text-center text-sm" style={{ color: "#444" }}>No hay nada esperando tu decisión.</p>}
                        {pendingReviews.map((review, index) => (
                            <div key={review.id} className="px-5 py-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-semibold" style={{ color: CREAM }}>{humanizeReviewKey(review.review_key)}</h3>
                                        <p className="mt-0.5 text-xs" style={{ color: "#666" }}>{formatDate(review.requested_at)}</p>
                                    </div>
                                    <Badge tone="amber">Pendiente</Badge>
                                </div>
                                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                                    <form action={approveReview}>
                                        <input type="hidden" name="reviewId" value={review.id} />
                                        <button className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white" style={{ background: "#4CAF82" }} type="submit">
                                            <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
                                        </button>
                                    </form>
                                    <form action={requestCorrection} className="flex flex-1 items-end gap-2">
                                        <input type="hidden" name="reviewId" value={review.id} />
                                        <input type="hidden" name="originalFrom" value="" />
                                        <input type="hidden" name="originalSubject" value={review.review_key} />
                                        <div className="flex-1">
                                            <input className="w-full rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "#222", background: "#0c0c0c", color: CREAM }} name="notes" placeholder="Notas de corrección" type="text" />
                                        </div>
                                        <button className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-semibold" style={{ borderColor: "#222", background: "#111", color: CREAM }} type="submit">
                                            <MessageSquare className="h-3.5 w-3.5" /> Pedir corrección
                                        </button>
                                    </form>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Exceptions */}
                <section className="rounded-xl border" style={{ borderColor: "#222", background: "#111" }}>
                    <div className="border-b px-5 py-4" style={{ borderColor: "#1a1a1a" }}>
                        <h2 className="text-sm font-semibold" style={{ color: CREAM }}>Problemas detectados ({exceptions.length})</h2>
                        <p className="mt-0.5 text-xs" style={{ color: "#666" }}>El sistema encontró estos problemas automáticamente.</p>
                    </div>
                    <div className="divide-y" style={{ borderColor: "#1a1a1a" }}>
                        {exceptions.length === 0 && <p className="px-5 py-8 text-center text-sm" style={{ color: "#444" }}>Sin problemas detectados — todo en orden.</p>}
                        {exceptions.map((ex) => {
                            const details = (ex.details || {}) as Record<string, unknown>;
                            const hint = getExceptionHint(ex.exception_key || "");
                            const correctable = isCorrectable(ex.exception_key || "");
                            const retryable = isRetryable(ex.exception_key || "");

                            return (
                                <div key={ex.id} className="px-5 py-5">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1">
                                            <h3 className="text-sm font-semibold" style={{ color: CREAM }}>{humanizeExceptionType(ex.exception_type)}</h3>
                                            <p className="mt-0.5 text-xs" style={{ color: "#666" }}>{formatDate(ex.created_at)}{ex.severity === "high" || ex.severity === "critical" ? " · Prioridad alta" : ""}</p>
                                            {hint && <p className="mt-1 text-xs" style={{ color: "#999" }}>{hint}</p>}
                                            {ex.exception_key && <p className="mt-1 text-[10px] font-mono" style={{ color: "#555" }}>{ex.exception_key}</p>}
                                        </div>
                                        <Badge tone={ex.severity === "high" || ex.severity === "critical" ? "red" : "amber"}>
                                            {ex.severity === "high" || ex.severity === "critical" ? "Urgente" : "Revisar"}
                                        </Badge>
                                    </div>

                                    {/* Details */}
                                    {Object.keys(details).length > 0 && (
                                        <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "#222", background: "#0c0c0c" }}>
                                            <p className="text-[10px] font-medium" style={{ color: "#666", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "8px" }}>Detalles</p>
                                            {Object.entries(details).map(([key, val]) => (
                                                <div key={key} className="flex justify-between py-1 text-xs" style={{ borderBottom: "1px solid #1a1a1a" }}>
                                                    <span style={{ color: "#666" }}>{key.replace(/_/g, " ")}</span>
                                                    <span style={{ color: CREAM, fontFamily: "monospace" }}>{typeof val === "number" ? val.toLocaleString("es-MX") : String(val).substring(0, 100)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Action buttons */}
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {/* Correct value */}
                                        {correctable && ex.workflow_run_id && (
                                            <form action={correctValue} className="flex items-end gap-2">
                                                <input type="hidden" name="exceptionId" value={ex.id} />
                                                <input type="hidden" name="workflowRunId" value={ex.workflow_run_id} />
                                                <div>
                                                    <input className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: "#222", background: "#0c0c0c", color: CREAM, width: "80px" }} name="field" placeholder="campo" type="text" />
                                                </div>
                                                <div>
                                                    <input className="rounded-lg border px-2 py-1.5 text-xs" style={{ borderColor: "#222", background: "#0c0c0c", color: CREAM, width: "100px" }} name="value" placeholder="valor" type="text" />
                                                </div>
                                                <button className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "#C9A84C44", background: "#C9A84C11", color: GOLD }} type="submit">
                                                    <Wrench className="h-3 w-3" /> Corregir
                                                </button>
                                            </form>
                                        )}

                                        {/* Retry */}
                                        {retryable && ex.workflow_run_id && (
                                            <form action={retryWorkflow}>
                                                <input type="hidden" name="exceptionId" value={ex.id} />
                                                <input type="hidden" name="workflowRunId" value={ex.workflow_run_id} />
                                                <button className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "#5A8AE044", background: "#5A8AE011", color: "#5A8AE0" }} type="submit">
                                                    <RefreshCw className="h-3 w-3" /> Reintentar
                                                </button>
                                            </form>
                                        )}

                                        {/* Resolve */}
                                        <form action={resolveException}>
                                            <input type="hidden" name="exceptionId" value={ex.id} />
                                            <button className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "#222", background: "#111", color: CREAM }} type="submit">
                                                <CheckCircle2 className="h-3 w-3" /> Ya lo resolví
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* Completed */}
                {completedReviews.length > 0 && (
                    <section className="rounded-xl border" style={{ borderColor: "#222", background: "#111" }}>
                        <div className="border-b px-5 py-4" style={{ borderColor: "#1a1a1a" }}>
                            <h2 className="text-sm font-semibold" style={{ color: CREAM }}>Historial ({completedReviews.length})</h2>
                        </div>
                        <div className="divide-y" style={{ borderColor: "#1a1a1a" }}>
                            {completedReviews.map((review) => (
                                <div key={review.id} className="flex items-center justify-between gap-4 px-5 py-3">
                                    <div>
                                        <span className="text-sm" style={{ color: CREAM }}>{humanizeReviewKey(review.review_key)}</span>
                                        {review.review_notes && <p className="mt-0.5 text-xs" style={{ color: "#666" }}>Notas: {review.review_notes}</p>}
                                    </div>
                                    <Badge tone={review.status === "approved" ? "green" : "neutral"}>
                                        {review.status === "approved" ? "Aprobada" : review.status === "changes_requested" ? "Corrección enviada" : review.status}
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
