import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Inbox,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { getDashboardData, type DashboardData } from "@/lib/dashboard-data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const statusLabels: Record<DashboardData["status"], string> = {
  ready: "Operativo",
  requires_config: "Config pendiente",
  auth_required: "Auth requerida",
  query_failed: "Consulta fallida",
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
    neutral: "border-stone-200 bg-stone-100 text-stone-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-700",
  };

  return (
    <span className={`rounded-md border px-2 py-1 text-xs font-medium ${tones[tone]}`}>
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
    <section className="rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-950">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">
      {label}
    </div>
  );
}

function ConfigBanner({ data, authMessage }: { data: DashboardData; authMessage?: string }) {
  if (authMessage === "check_email") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Revisá tu email para completar el ingreso.
      </div>
    );
  }

  if (data.status === "requires_config") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Faltan variables para conectar Supabase: {data.missingConfig.join(", ")}.
      </div>
    );
  }

  if (data.status === "auth_required") {
    return (
      <div className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
        Iniciá sesión para leer datos operativos protegidos por RLS.
      </div>
    );
  }

  if (data.status === "query_failed") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        No se pudieron consultar las tablas P0: {data.error}
      </div>
    );
  }

  return null;
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const authMessage = typeof params.auth === "string" ? params.auth : undefined;
  const data = await getDashboardData();
  const requiresReviewCount = data.runs.filter((run) => run.status === "requires_review").length;

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-stone-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-stone-500">
              <ShieldCheck className="h-4 w-4" />
              Santo AI OS · P0
            </div>
            <h1 className="text-3xl font-semibold text-stone-950">Panel operativo</h1>
            <p className="mt-2 max-w-2xl text-sm text-stone-600">
              Corte Santo, excepciones, revisión humana y Agent Mail en una sola vista.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={data.status === "ready" ? "green" : "amber"}>
              {statusLabels[data.status]}
            </Badge>
            <Badge>{data.role}</Badge>
            {data.userEmail ? <Badge>{data.userEmail}</Badge> : null}
            <Link
              className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100"
              href="/auth/sign-in"
            >
              Ingresar
            </Link>
          </div>
        </header>

        <ConfigBanner data={data} authMessage={authMessage} />

        <section className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">Runs Corte</span>
              <Clock3 className="h-4 w-4 text-stone-400" />
            </div>
            <div className="mt-3 text-2xl font-semibold">{data.runs.length}</div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">Requires review</span>
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-3 text-2xl font-semibold">{requiresReviewCount}</div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">Revisiones</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-3 text-2xl font-semibold">{data.reviews.length}</div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-stone-500">Agent Mail</span>
              <Mail className="h-4 w-4 text-stone-400" />
            </div>
            <div className="mt-3 text-2xl font-semibold">{data.emailMessages.length}</div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Panel
            title="Corte Santo"
            action={
              <button
                className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-500"
                disabled
                type="button"
              >
                Ejecutar por command handler
              </button>
            }
          >
            {data.runs.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-stone-500">
                    <tr>
                      <th className="pb-3 font-medium">Fecha</th>
                      <th className="pb-3 font-medium">Canal</th>
                      <th className="pb-3 font-medium">Estado</th>
                      <th className="pb-3 font-medium">Motivo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {data.runs.map((run) => (
                      <tr key={run.id}>
                        <td className="py-3 font-mono text-xs">{formatDate(run.business_date)}</td>
                        <td className="py-3">{run.source_channel}</td>
                        <td className="py-3">
                          <Badge tone={run.status === "requires_review" ? "amber" : "neutral"}>
                            {run.status}
                          </Badge>
                        </td>
                        <td className="py-3 text-stone-500">
                          {run.requires_review_reason ?? "Sin observación"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState label="Todavía no hay runs registrados para Corte Santo." />
            )}
          </Panel>

          <Panel title="Cola de revisión">
            {data.reviews.length ? (
              <div className="space-y-3">
                {data.reviews.map((review) => (
                  <div key={review.id} className="rounded-lg border border-stone-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{review.review_key}</span>
                      <Badge tone={review.status === "requires_review" ? "amber" : "neutral"}>
                        {review.status}
                      </Badge>
                    </div>
                    <div className="mt-2 font-mono text-xs text-stone-500">
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
                  <div key={exception.id} className="rounded-lg border border-stone-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{exception.exception_type}</span>
                      <Badge tone={exception.severity === "high" ? "red" : "amber"}>
                        {exception.severity}
                      </Badge>
                    </div>
                    <div className="mt-2 text-sm text-stone-500">{exception.status}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState label="No hay excepciones abiertas." />
            )}
          </Panel>

          <Panel title="Agent Mail">
            {data.emailMessages.length ? (
              <div className="space-y-3">
                {data.emailMessages.map((message) => (
                  <div key={message.id} className="rounded-lg border border-stone-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{message.subject ?? "Sin asunto"}</div>
                        <div className="mt-1 text-sm text-stone-500">{message.from_address}</div>
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
              <EmptyState label="No hay mensajes clasificados todavía." />
            )}
          </Panel>
        </section>

        <footer className="flex flex-wrap items-center gap-3 pb-4 text-xs text-stone-500">
          <LockKeyhole className="h-4 w-4" />
          Las acciones de escritura quedan reservadas para el command handler server-side.
          <RefreshCw className="h-4 w-4" />
          Inputs no confirmados permanecen como requires_review.
          <Inbox className="h-4 w-4" />
          Agent Mail no adivina routing ambiguo.
        </footer>
      </div>
    </main>
  );
}
