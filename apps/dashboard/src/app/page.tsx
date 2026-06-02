import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Inbox,
  LockKeyhole,
  Mail,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { simulateCorteSantoIntake } from "@/app/actions";
import { getDashboardData, type DashboardData } from "@/lib/dashboard-data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const statusLabels: Record<DashboardData["status"], string> = {
  ready: "Operativo",
  demo: "Demo",
  requires_config: "Config pendiente",
  auth_required: "Login requerido",
  query_failed: "Error de datos",
};

function formatDate(value: string | null) {
  if (!value) {
    return "Sin fecha";
  }

  if (!value.includes("T")) {
    return value;
  }

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    neutral: "border-zinc-300 bg-white text-zinc-700",
    green: "border-emerald-300 bg-emerald-50 text-emerald-800",
    blue: "border-sky-300 bg-sky-50 text-sky-800",
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    red: "border-red-300 bg-red-50 text-red-800",
  };

  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-300 bg-white shadow-sm">
      <div className="flex min-h-14 items-center justify-between gap-4 border-b border-zinc-200 px-5 py-4">
        <h2 className="text-base font-bold text-zinc-950">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center text-sm font-medium text-zinc-600">
      {label}
    </div>
  );
}

function ConnectionCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "green" | "amber" | "blue";
}) {
  const valueColor = {
    green: "text-emerald-800",
    amber: "text-amber-900",
    blue: "text-sky-800",
  }[tone];

  return (
    <div className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-zinc-600">{label}</span>
        {icon}
      </div>
      <div className={`mt-3 text-lg font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: "neutral" | "amber";
}) {
  return (
    <div className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-zinc-600">{label}</span>
        {icon}
      </div>
      <div className={`mt-3 text-3xl font-bold ${tone === "amber" ? "text-amber-900" : "text-zinc-950"}`}>
        {value}
      </div>
    </div>
  );
}

function WorkflowRow({
  name,
  description,
  status,
  primaryAction,
  secondaryAction,
}: {
  name: string;
  description: string;
  status: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 border-b border-zinc-200 py-4 last:border-b-0 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold text-zinc-950">{name}</h3>
          {status}
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-700">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {primaryAction}
        {secondaryAction}
      </div>
    </div>
  );
}

function RealStatusBanner({
  data,
  simulationStatus,
}: {
  data: DashboardData;
  simulationStatus?: string;
}) {
  if (simulationStatus === "created") {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-950">
        Simulacion escrita en Supabase. Si estas logueado, los registros aparecen en runs,
        revisiones, excepciones y Agent Mail.
      </div>
    );
  }

  if (simulationStatus) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950">
        No se pudo escribir la simulacion: {simulationStatus}. Revisa env vars, migracion y seeds.
      </div>
    );
  }

  if (data.status === "demo") {
    return (
      <div className="rounded-lg border border-sky-300 bg-sky-50 px-5 py-4 text-sm leading-6 text-sky-950">
        Estas viendo una simulacion local. Los botones muestran como se operaria P0; todavia no
        escriben en Supabase ni disparan Agent Mail real.
      </div>
    );
  }

  if (data.status === "requires_config") {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950">
        Falta conectar Supabase para leer datos reales: {data.missingConfig.join(", ")}.
      </div>
    );
  }

  if (data.status === "auth_required") {
    return (
      <div className="rounded-lg border border-zinc-300 bg-white px-5 py-4 text-sm leading-6 text-zinc-700">
        Inicia sesion para ver los datos protegidos por RLS.
      </div>
    );
  }

  if (data.status === "query_failed") {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 px-5 py-4 text-sm leading-6 text-red-900">
        No se pudieron consultar las tablas P0: {data.error}
      </div>
    );
  }

  return null;
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const demoMode = params.demo === "1" || params.demo === "true";
  const simulationStatus = typeof params.simulation === "string" ? params.simulation : undefined;
  const data = await getDashboardData({ demo: demoMode });
  const requiresReviewCount = data.runs.filter((run) => run.status === "requires_review").length;

  return (
    <main className="min-h-screen bg-zinc-100 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-lg border border-zinc-300 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-zinc-600">
                <ShieldCheck className="h-4 w-4" />
                Santo AI OS / P0
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-zinc-950">
                Operaciones P0
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-700">
                Corte Santo, revisiones, excepciones y conectores. Primero se simula, despues se
                conecta a Supabase y se activan workflows reales.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Badge tone={data.status === "ready" ? "green" : data.status === "demo" ? "blue" : "amber"}>
                {statusLabels[data.status]}
              </Badge>
              <Badge>{data.role}</Badge>
              {data.userEmail ? <Badge>{data.userEmail}</Badge> : null}
              <Link
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-100"
                href={demoMode ? "/" : "/?demo=1"}
              >
                {demoMode ? "Salir demo" : "Ver demo"}
              </Link>
            </div>
          </div>
        </header>

        <RealStatusBanner data={data} simulationStatus={simulationStatus} />

        <section className="grid gap-3 md:grid-cols-4">
          <ConnectionCard
            icon={<Database className="h-4 w-4 text-amber-700" />}
            label="Supabase"
            tone={data.status === "ready" ? "green" : "amber"}
            value={data.status === "ready" ? "Conectado" : "Pendiente"}
          />
          <ConnectionCard
            icon={<Server className="h-4 w-4 text-amber-700" />}
            label="Vercel"
            tone="amber"
            value="Pendiente"
          />
          <ConnectionCard
            icon={<Mail className="h-4 w-4 text-amber-700" />}
            label="Agent Mail"
            tone="amber"
            value="No seteado"
          />
          <ConnectionCard
            icon={<Play className="h-4 w-4 text-sky-700" />}
            label="Simulacion"
            tone="blue"
            value={demoMode ? "Activa" : "Disponible"}
          />
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard
            icon={<Clock3 className="h-4 w-4 text-zinc-500" />}
            label="Runs"
            value={data.runs.length}
          />
          <MetricCard
            icon={<AlertTriangle className="h-4 w-4 text-amber-700" />}
            label="Requires review"
            tone="amber"
            value={requiresReviewCount}
          />
          <MetricCard
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-700" />}
            label="Reviews"
            value={data.reviews.length}
          />
          <MetricCard
            icon={<Inbox className="h-4 w-4 text-zinc-500" />}
            label="Inbox demo"
            value={demoMode ? data.emailMessages.length : 0}
          />
        </section>

        <Panel title="Activar workflows">
          <WorkflowRow
            description="Workflow principal de P0. En demo crea un run sintetico con excepciones y review pendiente."
            name="Corte Santo"
            primaryAction={
              <form action={simulateCorteSantoIntake}>
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-sm font-bold text-white hover:bg-zinc-800"
                  type="submit"
                >
                  <Play className="h-4 w-4" />
                  Simular intake
                </button>
              </form>
            }
            secondaryAction={
              <button
                className="rounded-md border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm font-bold text-zinc-500"
                disabled
                type="button"
              >
                Ejecutar real pendiente
              </button>
            }
            status={<Badge tone="blue">P0 principal</Badge>}
          />
          <WorkflowRow
            description="Validacion fiscal delgada. Esta armada como modulo, pero necesita fixture XML real sanitizado."
            name="XML SAT"
            primaryAction={
              <Link
                className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-100"
                href="/?demo=1&workflow=xml_sat"
              >
                Simular XML
              </Link>
            }
            status={<Badge tone="amber">Thin validation</Badge>}
          />
          <WorkflowRow
            description="Debe esperar reglas de plantilla, Drive y alcance de Sheets antes de construirse."
            name="Utilidades"
            status={<Badge tone="amber">Bloqueado por config</Badge>}
          />
        </Panel>

        <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Panel title="Runs recientes">
            {data.runs.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-600">
                    <tr>
                      <th className="pb-3 pr-4 font-bold">Fecha</th>
                      <th className="pb-3 pr-4 font-bold">Canal</th>
                      <th className="pb-3 pr-4 font-bold">Estado</th>
                      <th className="pb-3 font-bold">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200">
                    {data.runs.map((run) => (
                      <tr key={run.id}>
                        <td className="py-3 pr-4 font-mono text-xs text-zinc-800">
                          {formatDate(run.business_date)}
                        </td>
                        <td className="py-3 pr-4 text-zinc-800">{run.source_channel}</td>
                        <td className="py-3 pr-4">
                          <Badge tone={run.status === "requires_review" ? "amber" : "neutral"}>
                            {run.status}
                          </Badge>
                        </td>
                        <td className="py-3 text-zinc-700">
                          {run.requires_review_reason ?? "Sin observacion"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState label="Todavia no hay runs. Usa Simular intake para ver el flujo P0." />
            )}
          </Panel>

          <Panel title="Cola de revision">
            {data.reviews.length ? (
              <div className="space-y-3">
                {data.reviews.map((review) => (
                  <div key={review.id} className="rounded-lg border border-zinc-300 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-bold text-zinc-950">{review.review_key}</span>
                      <Badge tone={review.status === "requires_review" ? "amber" : "neutral"}>
                        {review.status}
                      </Badge>
                    </div>
                    <div className="mt-2 font-mono text-xs text-zinc-600">
                      {formatDate(review.requested_at)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState label="No hay revisiones pendientes." />
            )}
          </Panel>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Panel title="Excepciones">
            {data.exceptions.length ? (
              <div className="space-y-3">
                {data.exceptions.map((exception) => (
                  <div key={exception.id} className="rounded-lg border border-zinc-300 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-bold text-zinc-950">{exception.exception_type}</span>
                      <Badge tone={exception.severity === "high" ? "red" : "amber"}>
                        {exception.severity}
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm font-medium text-zinc-700">{exception.status}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState label="No hay excepciones abiertas." />
            )}
          </Panel>

          <Panel
            action={<Badge tone="amber">No conectado</Badge>}
            title="Agent Mail"
          >
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
              El inbox real de Agent Mail/Gmail todavia no esta seteado. Abajo solo se muestran
              mensajes demo para probar clasificacion.
            </div>
            {data.emailMessages.length ? (
              <div className="space-y-3">
                {data.emailMessages.map((message) => (
                  <div key={message.id} className="rounded-lg border border-zinc-300 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-bold text-zinc-950">{message.subject ?? "Sin asunto"}</div>
                        <div className="mt-1 text-sm text-zinc-700">{message.from_address}</div>
                      </div>
                      <Badge
                        tone={message.processing_status === "requires_review" ? "amber" : "neutral"}
                      >
                        {message.processing_status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState label="Sin mensajes demo. Activa el modo demo para ver ejemplos." />
            )}
          </Panel>
        </section>

        <footer className="flex flex-wrap items-center gap-3 pb-4 text-xs font-medium text-zinc-600">
          <LockKeyhole className="h-4 w-4" />
          Escrituras reales solo por command handler server-side.
          <RefreshCw className="h-4 w-4" />
          Config faltante queda como requires_review.
        </footer>
      </div>
    </main>
  );
}
