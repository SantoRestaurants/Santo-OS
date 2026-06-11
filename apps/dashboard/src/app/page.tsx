import {
  Activity,
  AlertTriangle,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { getDashboardData, type DashboardData } from "@/lib/dashboard-data";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Metric } from "@/components/ui/Metric";

import type { Tone } from "@/components/ui/Badge";


function SystemBanner({ data }: { data: DashboardData }) {
  if (data.status === "requires_config") {
    return (
      <div data-tour="system-banner" className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div>
          <p className="text-sm font-semibold text-amber-900">Supabase todavía no está conectado</p>
          <p className="mt-1 text-xs text-amber-800">Configure las variables de entorno de Supabase en <code>.env.local</code> para iniciar.</p>
        </div>
      </div>
    );
  }
  if (data.status === "auth_required") {
    return (
      <div data-tour="system-banner" className="flex items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-5">
        <div>
          <p className="text-sm font-semibold text-stone-900">Inicia sesión para ver operaciones reales</p>
          <p className="mt-1 text-xs text-stone-600">Es necesario autenticarse para interactuar con la plataforma.</p>
        </div>
        <Link className="rounded-xl bg-stone-950 px-4 py-2 text-xs font-semibold text-white" href="/auth/sign-in">Iniciar sesión</Link>
      </div>
    );
  }
  if (data.status === "query_failed") {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-xs text-rose-800">No se pudieron consultar los datos: {data.error}</div>;
  }
  return null;
}

function LiveView({ data }: { data: DashboardData }) {
  const needsReview = data.runs.filter((run) => run.status === "requires_review").length;
  return (
    <div className="flex flex-col gap-5">
      <section data-tour="metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Operaciones" value={String(data.runs.length)} detail="Últimas registradas" icon={<Activity className="h-4 w-4" />} tone="stone" />
        <Metric
          label="Necesitan revisión"
          value={String(needsReview)}
          detail="Esperando decisión humana"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="amber"
        />
        <Metric label="Revisiones" value={String(data.reviews.length)} detail="Cola de decisiones" icon={<ShieldCheck className="h-4 w-4" />} tone="green" />
        <Metric label="Emails" value={String(data.emailMessages.length)} detail="Procesados por Agent Mail" icon={<Mail className="h-4 w-4" />} tone="blue" />
      </section>
      <Card dataTour="operations" title="Operaciones recientes" eyebrow="Registro operativo">
        {data.runs.length === 0 ? (
          <p className="py-8 text-center text-xs text-stone-600">No hay operaciones registradas todavía.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            {data.runs.map((run) => (
              <div className="grid gap-2 py-3 text-xs sm:grid-cols-[1fr_1fr_1fr_2fr]" key={run.id}>
                <span className="font-mono text-stone-600">{run.business_date ?? "Sin fecha"}</span>
                <span className="text-stone-700">{formatChannel(run.source_channel)}</span>
                <span><Badge tone={statusTone(run.status)}>{formatStatus(run.status)}</Badge></span>
                <span className="text-stone-600">{humanizeReason(run.requires_review_reason)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card dataTour="exceptions" title="Excepciones" eyebrow="Atención requerida">
          <SimpleList rows={data.exceptions.map((item) => ({ id: item.id, title: humanize(item.exception_type), status: item.severity }))} />
        </Card>
        <Card dataTour="agent-mail" title="Agent Mail" eyebrow="Últimos mensajes">
          <SimpleList rows={data.emailMessages.map((item) => ({ id: item.id, title: item.subject ?? "Sin asunto", status: formatStatus(item.processing_status) }))} />
        </Card>
      </div>
    </div>
  );
}

function SimpleList({ rows }: { rows: { id: string; title: string; status: string }[] }) {
  if (!rows.length) return <p className="py-8 text-center text-xs text-stone-600">Nada pendiente.</p>;
  return (
    <div className="divide-y divide-stone-100">
      {rows.map((row) => (
        <div className="flex items-center justify-between gap-3 py-3" key={row.id}>
          <p className="truncate text-xs font-medium text-stone-700">{row.title}</p>
          <Badge tone="neutral">{row.status}</Badge>
        </div>
      ))}
    </div>
  );
}

function formatStatus(status: string) {
  const labels: Record<string, string> = {
    requires_review: "Necesita revisión",
    completed: "Completado",
    queued: "En cola",
    running: "Procesando",
    waiting_for_input: "Esperando datos",
    failed: "Error",
    classified: "Clasificado",
    linked: "Vinculado",
    received: "Recibido",
  };
  return labels[status] ?? humanize(status);
}

function formatChannel(channel: string) {
  const labels: Record<string, string> = { dashboard: "Dashboard", agent_mail: "Agent Mail", scheduler: "Automático", system: "Sistema" };
  return labels[channel] ?? humanize(channel);
}

function statusTone(status: string): Tone {
  if (status === "requires_review") return "amber";
  if (status === "completed" || status === "linked" || status === "classified") return "green";
  if (status === "failed") return "red";
  return "neutral";
}

function humanizeReason(reason: string | null) {
  if (!reason) return "Sin bloqueo";
  if (reason.includes("drive_folder_map")) return "Falta confirmar la carpeta de Drive";
  if (reason.includes("thresholds")) return "Faltan tolerancias confirmadas";
  if (reason.includes("reviewer_map")) return "Falta confirmar responsable";
  if (reason.includes("mandatory_attachments")) return "Faltan documentos obligatorios";
  if (reason.includes("rfc_map")) return "Falta confirmar mapa de RFCs";
  return humanize(reason);
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

export default async function Home() {
  const data = await getDashboardData();

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header data-tour="header" className="flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 pl-10 lg:pl-0">
            <span className="rounded-xl bg-stone-950 p-2 text-white"><Sparkles className="h-4 w-4" /></span>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-stone-950">Santo AI OS</p>
                <Badge tone="green">Operación</Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-stone-600">Admin · HR · Nómina · Contabilidad · Fiscal</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2">
            {data.userEmail && <span className="mr-2 text-[11px] text-stone-600">{data.userEmail}</span>}
            {data.userEmail ? (
              <Link className="rounded-xl bg-stone-950 px-3 py-2 text-xs font-semibold text-white" href="/reviews">Abrir revisiones</Link>
            ) : (
              <Link className="rounded-xl bg-stone-950 px-3 py-2 text-xs font-semibold text-white" href="/auth/sign-in">Iniciar sesión</Link>
            )}
          </nav>
        </header>
        <SystemBanner data={data} />
        <LiveView data={data} />
      </div>
    </div>
  );
}
