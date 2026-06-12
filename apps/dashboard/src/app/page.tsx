import { CheckCircle2, ClipboardList, FileText } from "lucide-react";
import Link from "next/link";

import { getDashboardData, type DashboardData } from "@/lib/dashboard-data";
import { Badge } from "@/components/ui/Badge";

import type { Tone } from "@/components/ui/Badge";


function SystemBanner({ data }: { data: DashboardData }) {
  if (data.status === "requires_config") {
    return (
      <div data-tour="system-banner" className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-900">El sistema todavía no está conectado</p>
        <p className="mt-1 text-xs text-amber-800">Falta terminar la configuración inicial. Avísale al equipo técnico.</p>
      </div>
    );
  }
  if (data.status === "auth_required") {
    return (
      <div data-tour="system-banner" className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-5">
        <div>
          <p className="text-sm font-semibold text-stone-900">Inicia sesión para empezar</p>
          <p className="mt-1 text-xs text-stone-600">Necesitas entrar con tu correo para ver tus pendientes.</p>
        </div>
        <Link className="rounded-xl bg-stone-950 px-4 py-2 text-xs font-semibold text-white" href="/auth/sign-in">Iniciar sesión</Link>
      </div>
    );
  }
  if (data.status === "query_failed") {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-xs text-rose-800">No se pudo cargar la información. Intenta de nuevo en un momento.</div>;
  }
  return null;
}

function PendingHero({ count }: { count: number }) {
  if (count === 0) {
    return (
      <div data-tour="needs-decision" className="flex items-center gap-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <span className="rounded-2xl bg-emerald-100 p-3 text-emerald-700"><CheckCircle2 className="h-6 w-6" /></span>
        <div>
          <p className="text-base font-semibold text-emerald-900">Todo al día</p>
          <p className="mt-0.5 text-sm text-emerald-800">No tienes nada esperando tu revisión por ahora.</p>
        </div>
      </div>
    );
  }
  return (
    <Link
      href="/reviews"
      data-tour="needs-decision"
      className="flex items-center justify-between gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-6 transition hover:bg-amber-100"
    >
      <div className="flex items-center gap-4">
        <span className="rounded-2xl bg-amber-100 p-3 text-amber-700"><ClipboardList className="h-6 w-6" /></span>
        <div>
          <p className="text-base font-semibold text-amber-900">
            {count === 1 ? "Tienes 1 corte esperando tu revisión" : `Tienes ${count} cortes esperando tu revisión`}
          </p>
          <p className="mt-0.5 text-sm text-amber-800">Toca aquí para revisarlos y aprobarlos.</p>
        </div>
      </div>
      <span className="hidden rounded-xl bg-amber-900 px-4 py-2 text-xs font-semibold text-white sm:inline">Revisar ahora</span>
    </Link>
  );
}

function RecentCortes({ data }: { data: DashboardData }) {
  return (
    <section data-tour="cortes" className="rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-4">
        <FileText className="h-4 w-4 text-stone-500" />
        <h2 className="text-sm font-semibold text-stone-900">Cortes recientes</h2>
      </div>
      {data.runs.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-stone-600">Todavía no llega ningún corte.</p>
      ) : (
        <div className="divide-y divide-stone-100">
          {data.runs.map((run) => (
            <div className="flex items-center justify-between gap-3 px-5 py-4" key={run.id}>
              <div>
                <p className="text-sm font-medium text-stone-800">{formatDate(run.business_date)}</p>
                <p className="mt-0.5 text-xs text-stone-600">{plainExplanation(run.status, run.requires_review_reason)}</p>
              </div>
              <Badge tone={statusTone(run.status)}>{formatStatus(run.status)}</Badge>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    requires_review: "Necesita revisión",
    ready_for_approval: "Listo para aprobar",
    completed: "Aprobado",
    queued: "En proceso",
    running: "En proceso",
    waiting_for_input: "Faltan datos",
    failed: "Con error",
  };
  return labels[status] ?? "En proceso";
}

function statusTone(status: string): Tone {
  if (status === "requires_review" || status === "waiting_for_input") return "amber";
  if (status === "completed") return "green";
  if (status === "ready_for_approval") return "blue";
  if (status === "failed") return "red";
  return "neutral";
}

function plainExplanation(status: string, reason: string | null) {
  if (status === "completed") return "Revisado y aprobado.";
  if (status === "ready_for_approval") return "El corte cuadró. Falta tu aprobación.";
  if (!reason) {
    if (status === "requires_review") return "Hay algo que revisar.";
    return "En proceso.";
  }
  if (reason.includes("drive_folder_map")) return "Falta indicar en qué carpeta se guarda.";
  if (reason.includes("reconciliation_discrepancy")) return "Las cuentas no cuadran. Hay que revisarlo.";
  if (reason.includes("extraction")) return "No se pudo leer bien el archivo del corte.";
  if (reason.includes("mandatory_attachments") || reason.includes("missing_documents")) return "Falta algún documento del corte.";
  if (reason.includes("reviewer_map")) return "Falta indicar quién lo revisa.";
  return "Hay algo que revisar.";
}

function formatDate(date: string | null) {
  if (!date) return "Corte sin fecha";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long" }).format(parsed);
}

export default async function Home() {
  const data = await getDashboardData();
  const needsReview = data.runs.filter((run) => run.status === "requires_review").length;
  const isLive = data.status === "ready";

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header data-tour="header" className="flex flex-col gap-1 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold text-stone-900">Hola{data.userEmail ? "" : ""}, este es tu panel</h1>
          <p className="text-sm text-stone-600">Aquí ves los cortes del día y lo que necesita tu revisión.</p>
        </header>

        <SystemBanner data={data} />

        {isLive && (
          <>
            <PendingHero count={needsReview} />
            <RecentCortes data={data} />
          </>
        )}
      </div>
    </div>
  );
}
