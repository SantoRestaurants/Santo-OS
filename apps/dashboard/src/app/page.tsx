import { CheckCircle2, ClipboardList, FileText } from "lucide-react";
import Link from "next/link";

import { getDashboardData, type DashboardData } from "@/lib/dashboard-data";
import { Badge } from "@/components/ui/Badge";

import type { Tone } from "@/components/ui/Badge";

const GOLD = "#C9A84C";
const CREAM = "#E8E0D0";

function SystemBanner({ data }: { data: DashboardData }) {
  if (data.status === "requires_config") {
    return (
      <div className="rounded-2xl border p-5" style={{ borderColor: "#E08A3A44", background: "#E08A3A11" }}>
        <p className="text-sm font-semibold" style={{ color: "#E08A3A" }}>El sistema todavía no está conectado</p>
        <p className="mt-1 text-xs" style={{ color: "#E08A3Aaa" }}>Falta terminar la configuración inicial. Avísale al equipo técnico.</p>
      </div>
    );
  }
  if (data.status === "auth_required") {
    return (
      <div className="flex items-center justify-between gap-4 rounded-2xl border p-5" style={{ borderColor: "#222", background: "#111" }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: CREAM }}>Inicia sesión para empezar</p>
          <p className="mt-1 text-xs" style={{ color: "#666" }}>Necesitas entrar con tu correo para ver tus pendientes.</p>
        </div>
        <Link className="rounded-xl px-4 py-2 text-xs font-semibold" style={{ background: GOLD, color: "#080808" }} href="/auth/sign-in">Iniciar sesión</Link>
      </div>
    );
  }
  if (data.status === "query_failed") {
    return <div className="rounded-2xl border p-5 text-xs" style={{ borderColor: "#E05A5A44", background: "#E05A5A11", color: "#E05A5A" }}>No se pudo cargar la información. Intenta de nuevo en un momento.</div>;
  }
  return null;
}

function PendingHero({ count }: { count: number }) {
  if (count === 0) {
    return (
      <div data-tour="needs-decision" className="flex items-center gap-4 rounded-2xl border p-6" style={{ borderColor: "#4CAF8244", background: "#4CAF8211" }}>
        <span className="rounded-2xl p-3" style={{ background: "#4CAF8222", color: "#4CAF82" }}><CheckCircle2 className="h-6 w-6" /></span>
        <div>
          <p className="text-base font-semibold" style={{ color: "#4CAF82" }}>Todo al día</p>
          <p className="mt-0.5 text-sm" style={{ color: "#4CAF82aa" }}>No tienes nada esperando tu revisión por ahora.</p>
        </div>
      </div>
    );
  }
  return (
    <Link
      href="/reviews"
      data-tour="needs-decision"
      className="flex items-center justify-between gap-4 rounded-2xl border p-6 transition"
      style={{ borderColor: "#C9A84C44", background: "#C9A84C11" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#C9A84C22"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "#C9A84C11"; }}
    >
      <div className="flex items-center gap-4">
        <span className="rounded-2xl p-3" style={{ background: "#C9A84C22", color: GOLD }}><ClipboardList className="h-6 w-6" /></span>
        <div>
          <p className="text-base font-semibold" style={{ color: GOLD }}>
            {count === 1 ? "Tienes 1 corte esperando tu revisión" : `Tienes ${count} cortes esperando tu revisión`}
          </p>
          <p className="mt-0.5 text-sm" style={{ color: "#C9A84Caa" }}>Toca aquí para revisarlos y aprobarlos.</p>
        </div>
      </div>
      <span className="hidden rounded-xl px-4 py-2 text-xs font-semibold sm:inline" style={{ background: GOLD, color: "#080808" }}>Revisar ahora</span>
    </Link>
  );
}

function RecentCortes({ data }: { data: DashboardData }) {
  return (
    <section data-tour="cortes" className="rounded-2xl border" style={{ borderColor: "#222", background: "#111" }}>
      <div className="flex items-center gap-2 border-b px-5 py-4" style={{ borderColor: "#1a1a1a" }}>
        <FileText className="h-4 w-4" style={{ color: "#666" }} />
        <h2 className="text-sm font-semibold" style={{ color: CREAM }}>Cortes recientes</h2>
      </div>
      {data.runs.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm" style={{ color: "#444" }}>Todavía no llega ningún corte.</p>
      ) : (
        <div className="divide-y" style={{ borderColor: "#1a1a1a" }}>
          {data.runs.map((run) => (
            <div className="flex items-center justify-between gap-3 px-5 py-4" key={run.id}>
              <div>
                <p className="text-sm font-medium" style={{ color: CREAM }}>{formatDate(run.business_date)}</p>
                <p className="mt-0.5 text-xs" style={{ color: "#666" }}>{plainExplanation(run.status, run.requires_review_reason)}</p>
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
    <div style={{ minHeight: "100vh" }}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header data-tour="header" className="flex flex-col gap-1 pl-10 lg:pl-0">
          <h1 className="text-2xl font-bold" style={{ color: GOLD, letterSpacing: "2px", textTransform: "uppercase" }}>Panel de Cortes</h1>
          <p className="text-sm" style={{ color: "#666" }}>Aquí ves los cortes del día y lo que necesita tu revisión.</p>
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
