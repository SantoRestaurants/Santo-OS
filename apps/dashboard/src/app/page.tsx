import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock3,
  FileText,
  Inbox,
  Mail,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { getDashboardData, type DashboardData } from "@/lib/dashboard-data";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/* ─── UI Primitives ─── */

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    neutral: "border-zinc-300 bg-zinc-100 text-zinc-900",
    green: "border-emerald-300 bg-emerald-100 text-emerald-900",
    blue: "border-sky-300 bg-sky-100 text-sky-900",
    amber: "border-amber-300 bg-amber-100 text-amber-950",
    red: "border-red-300 bg-red-100 text-red-950",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="py-6 text-center text-sm text-zinc-700">{text}</p>
  );
}

function StatusDot({ color }: { color: "green" | "amber" | "red" | "gray" }) {
  const colors = {
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    gray: "bg-zinc-300",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[color]}`} />;
}

/* ─── System Status Banner ─── */

function SystemBanner({ data }: { data: DashboardData }) {
  if (data.status === "requires_config") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h3 className="font-semibold text-amber-900">Falta conectar la base de datos</h3>
        <p className="mt-1 text-sm text-amber-800">
          El dashboard necesita las variables de Supabase para funcionar. Mientras tanto, podés ver
          el modo demo para entender cómo se vería en producción.
        </p>
      </div>
    );
  }

  if (data.status === "auth_required") {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5">
        <h3 className="font-semibold text-zinc-900">Iniciá sesión para ver los datos</h3>
        <p className="mt-1 text-sm text-zinc-600">
          Los datos operativos están protegidos. Necesitás iniciar sesión para ver las operaciones
          del día.
        </p>
        <Link
          className="mt-3 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          href="/auth/sign-in"
        >
          Iniciar sesión
        </Link>
      </div>
    );
  }

  if (data.status === "query_failed") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h3 className="font-semibold text-red-900">Error al consultar datos</h3>
        <p className="mt-1 text-sm text-red-800">
          Puede que la migración SQL no se haya ejecutado todavía en Supabase. Error: {data.error}
        </p>
      </div>
    );
  }

  return null;
}

/* ─── Demo Mode Content ─── */

function DemoView() {
  return (
    <div className="flex flex-col gap-5">
      {/* What is this */}
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-5">
        <h3 className="font-semibold text-sky-900">Esto es una demostración</h3>
        <p className="mt-1 text-sm text-sky-800">
          Estás viendo datos de ejemplo para entender cómo funciona el sistema. Nada de esto es
          real — cuando se conecten los datos operativos de Santo, acá vas a ver las operaciones
          reales del día a día.
        </p>
      </div>

      {/* How the system works */}
      <Card title="¿Cómo funciona Santo AI OS?">
        <div className="space-y-4 text-sm text-zinc-700">
          <p>
            Santo AI OS automatiza el seguimiento diario de operaciones del restaurante. En vez de
            que alguien revise todo manualmente, el sistema:
          </p>
          <ol className="list-inside list-decimal space-y-3 pl-1">
            <li>
              <strong>Recibe información</strong> — por email, por el dashboard, o automáticamente.
              Por ejemplo: los documentos del cierre de caja del día.
            </li>
            <li>
              <strong>Procesa y verifica</strong> — revisa que esté todo (¿están todos los
              comprobantes? ¿cuadran los números?).
            </li>
            <li>
              <strong>Marca lo que necesita atención humana</strong> — si algo no cuadra o falta
              información, lo señala para que una persona lo revise. Nunca aprueba solo.
            </li>
            <li>
              <strong>Deja registro de todo</strong> — cada acción queda registrada para auditoría.
              Nada se pierde ni se sobreescribe.
            </li>
          </ol>
        </div>
      </Card>

      {/* The daily flow */}
      <Card title="Flujo diario: Corte Santo (ejemplo)">
        <div className="space-y-1">
          <FlowStep
            number={1}
            status="done"
            title="Llega el email con documentos del día"
            detail="El gerente manda un email con asunto [CORTE] al inbox del sistema. Adjunta el PDF del corte y el CSV del banco."
          />
          <FlowStep
            number={2}
            status="done"
            title="El sistema clasifica el email"
            detail="Agent Mail lee el asunto, identifica que es un Corte Santo, y crea el registro automáticamente."
          />
          <FlowStep
            number={3}
            status="review"
            title="Verifica documentos y reglas"
            detail="Revisa que estén los archivos obligatorios y que los montos estén dentro de los rangos aceptables."
          />
          <FlowStep
            number={4}
            status="review"
            title="Señala excepciones"
            detail="Si falta algo o hay una diferencia rara, crea una excepción y pide revisión humana."
          />
          <FlowStep
            number={5}
            status="pending"
            title="Revisión y aprobación"
            detail="Un responsable revisa las excepciones en el dashboard y aprueba o pide correcciones."
          />
        </div>
      </Card>

      {/* Example data */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Operaciones del día (ejemplo)">
          <div className="space-y-3">
            <DemoRunRow
              date="2 Jun 2026"
              restaurant="Unidad Centro"
              status="Necesita revisión"
              reason="Faltan reglas de configuración del restaurante"
              tone="amber"
            />
            <DemoRunRow
              date="1 Jun 2026"
              restaurant="Unidad Centro"
              status="Necesita revisión"
              reason="Falta fixture XML real para validar facturas"
              tone="amber"
            />
          </div>
        </Card>

        <Card title="Emails procesados (ejemplo)">
          <div className="space-y-3">
            <DemoEmailRow
              from="gerencia@santo.com"
              subject="[CORTE] Corte Santo 2 Jun - Unidad Centro"
              status="Clasificado correctamente"
              tone="green"
            />
            <DemoEmailRow
              from="proveedor@example.com"
              subject="facturas varias"
              status="No se pudo clasificar — requiere revisión"
              tone="amber"
            />
          </div>
        </Card>
      </div>

      {/* What's ready vs what's pending */}
      <Card title="Estado actual del proyecto">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h4 className="mb-3 text-sm font-semibold text-emerald-800">✓ Ya construido</h4>
            <ul className="space-y-2 text-sm text-zinc-700">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                Dashboard operativo con auth y roles
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                Base de datos con seguridad (RLS) desde el inicio
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                Agent Mail — clasifica emails automáticamente
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                Corte Santo — registra operaciones del día
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                Validación de XMLs del SAT (facturas)
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                Protección contra duplicados (idempotencia)
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                Auditoría completa de cada acción
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-3 text-sm font-semibold text-amber-800">⏳ Pendiente del equipo Santo</h4>
            <ul className="space-y-2 text-sm text-zinc-700">
              <li className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                Rangos aceptables para diferencias de caja
              </li>
              <li className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                Quién revisa cada tipo de excepción
              </li>
              <li className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                Carpetas de Google Drive (estructura y permisos)
              </li>
              <li className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                Mapeo de restaurantes, entidades y RFCs
              </li>
              <li className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                Convención de emails (cómo se mandan los cortes)
              </li>
              <li className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                Un XML real anonimizado para probar facturas
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {/* Key principle */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5">
        <p className="text-sm font-medium text-zinc-700">
          <strong>Principio clave:</strong> El sistema nunca inventa datos ni aprueba solo. Si le
          falta información, marca la operación como &quot;necesita revisión&quot; y espera a que una
          persona decida. Esto protege contra errores y asegura que todo quede trazable.
        </p>
      </div>
    </div>
  );
}

/* ─── Flow Step ─── */

function FlowStep({
  number,
  title,
  detail,
  status,
}: {
  number: number;
  title: string;
  detail: string;
  status: "done" | "review" | "pending";
}) {
  const icon = {
    done: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
    review: <AlertTriangle className="h-5 w-5 text-amber-600" />,
    pending: <Circle className="h-5 w-5 text-zinc-300" />,
  }[status];

  return (
    <div className="flex gap-3 rounded-lg p-3 hover:bg-zinc-50">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <div className="text-sm font-medium text-zinc-900">
          {number}. {title}
        </div>
        <p className="mt-0.5 text-sm text-zinc-600">{detail}</p>
      </div>
    </div>
  );
}

/* ─── Demo Rows ─── */

function DemoRunRow({
  date,
  restaurant,
  status,
  reason,
  tone,
}: {
  date: string;
  restaurant: string;
  status: string;
  reason: string;
  tone: "green" | "amber";
}) {
  return (
    <div className="rounded-lg border border-zinc-100 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-zinc-900">{restaurant} — {date}</div>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <p className="mt-1 text-xs text-zinc-700">{reason}</p>
    </div>
  );
}

function DemoEmailRow({
  from,
  subject,
  status,
  tone,
}: {
  from: string;
  subject: string;
  status: string;
  tone: "green" | "amber";
}) {
  return (
    <div className="rounded-lg border border-zinc-100 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-zinc-900">{subject}</div>
          <div className="mt-0.5 text-xs text-zinc-700">{from}</div>
        </div>
        <Badge tone={tone}>{status}</Badge>
      </div>
    </div>
  );
}

/* ─── Live Data View ─── */

function LiveView({ data }: { data: DashboardData }) {
  const requiresReviewCount = data.runs.filter((r) => r.status === "requires_review").length;

  return (
    <div className="flex flex-col gap-5">
      {/* Metrics */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-700">Operaciones</span>
            <FileText className="h-4 w-4 text-zinc-600" />
          </div>
          <div className="mt-2 text-2xl font-bold">{data.runs.length}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-700">Necesitan revisión</span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-amber-700">{requiresReviewCount}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-700">En cola de revisión</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold">{data.reviews.length}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-700">Emails recibidos</span>
            <Mail className="h-4 w-4 text-zinc-600" />
          </div>
          <div className="mt-2 text-2xl font-bold">{data.emailMessages.length}</div>
        </div>
      </section>

      {/* Runs */}
      <Card title="Operaciones recientes">
        {data.runs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs text-zinc-700">
                <tr>
                  <th className="pb-2 pr-4 font-medium">Fecha</th>
                  <th className="pb-2 pr-4 font-medium">Origen</th>
                  <th className="pb-2 pr-4 font-medium">Estado</th>
                  <th className="pb-2 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {data.runs.map((run) => (
                  <tr key={run.id}>
                    <td className="py-2.5 pr-4 font-mono text-xs">{run.business_date ?? "—"}</td>
                    <td className="py-2.5 pr-4">{formatChannel(run.source_channel)}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={statusTone(run.status)}>{formatStatus(run.status)}</Badge>
                    </td>
                    <td className="py-2.5 text-zinc-600">
                      {humanizeReason(run.requires_review_reason)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No hay operaciones registradas todavía." />
        )}
      </Card>

      {/* Exceptions + Reviews */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Excepciones">
          {data.exceptions.length ? (
            <div className="space-y-2">
              {data.exceptions.map((ex) => (
                <div key={ex.id} className="flex items-center justify-between rounded-lg border border-zinc-100 p-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-900">
                      {humanizeExceptionType(ex.exception_type)}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-700">{formatStatus(ex.status)}</div>
                  </div>
                  <Badge tone={ex.severity === "high" || ex.severity === "critical" ? "red" : "amber"}>
                    {ex.severity === "high" || ex.severity === "critical" ? "Alta" : "Media"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Sin excepciones — todo en orden." />
          )}
        </Card>

        <Card title="Pendientes de revisión">
          {data.reviews.length ? (
            <div className="space-y-2">
              {data.reviews.map((review) => (
                <div key={review.id} className="flex items-center justify-between rounded-lg border border-zinc-100 p-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-900">
                      {humanizeReviewKey(review.review_key)}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-700">{formatStatus(review.status)}</div>
                  </div>
                  <StatusDot color={review.status === "requires_review" ? "amber" : "green"} />
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Nada pendiente de revisión." />
          )}
        </Card>
      </div>

      {/* Agent Mail */}
      <Card title="Emails procesados">
        {data.emailMessages.length ? (
          <div className="space-y-2">
            {data.emailMessages.map((msg) => (
              <div key={msg.id} className="flex items-start justify-between gap-3 rounded-lg border border-zinc-100 p-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900">{msg.subject ?? "Sin asunto"}</div>
                  <div className="mt-0.5 text-xs text-zinc-700">{msg.from_address}</div>
                </div>
                <Badge tone={msg.processing_status === "requires_review" ? "amber" : msg.processing_status === "classified" || msg.processing_status === "linked" ? "green" : "neutral"}>
                  {formatEmailStatus(msg.processing_status)}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="No se han procesado emails todavía." />
        )}
      </Card>
    </div>
  );
}

/* ─── Helpers ─── */

function formatChannel(ch: string) {
  const map: Record<string, string> = {
    dashboard: "Dashboard",
    agent_mail: "Email",
    scheduler: "Automático",
    whatsapp_stub: "WhatsApp",
    system: "Sistema",
  };
  return map[ch] ?? ch;
}

function formatStatus(s: string) {
  const map: Record<string, string> = {
    requires_review: "Necesita revisión",
    completed: "Completado",
    queued: "En cola",
    running: "Procesando",
    waiting_for_input: "Esperando datos",
    failed: "Error",
    cancelled: "Cancelado",
    open: "Abierta",
    acknowledged: "Reconocida",
    resolved: "Resuelta",
    dismissed: "Descartada",
    requested: "Solicitada",
    approved: "Aprobada",
    rejected: "Rechazada",
  };
  return map[s] ?? s;
}

function statusTone(s: string) {
  if (s === "requires_review" || s === "open" || s === "requested") return "amber";
  if (s === "completed" || s === "resolved" || s === "approved") return "green";
  if (s === "failed") return "red";
  return "neutral";
}

function humanizeReason(reason: string | null) {
  if (!reason) return "—";
  // Replace technical messages with human-readable ones
  if (reason.includes("thresholds")) return "Faltan rangos de tolerancia configurados";
  if (reason.includes("reviewer_map")) return "No se definió quién revisa";
  if (reason.includes("drive_folder_map")) return "Carpetas de Drive no configuradas";
  if (reason.includes("mandatory_attachments")) return "Faltan documentos obligatorios";
  if (reason.includes("rfc_map")) return "Mapeo de RFCs no configurado";
  if (reason.includes("MiAdminXML")) return "Falta archivo XML real para validar";
  return reason;
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

function humanizeReviewKey(k: string) {
  const map: Record<string, string> = {
    review_corte_intake_config: "Revisar configuración del Corte",
    confirm_agent_mail_routing: "Confirmar reglas de email",
    demo_review_corte_intake: "Revisar intake del Corte",
    demo_confirm_agent_mail_setup: "Confirmar setup de email",
    demo_confirm_operational_config: "Confirmar configuración operativa",
  };
  return map[k] ?? k.replace(/_/g, " ");
}

function formatEmailStatus(s: string) {
  const map: Record<string, string> = {
    received: "Recibido",
    classified: "Clasificado",
    linked: "Vinculado",
    requires_review: "Necesita revisión",
    ignored: "Ignorado",
    failed: "Error",
  };
  return map[s] ?? s;
}

/* ─── Main Page ─── */

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const demoMode = params.demo === "1" || params.demo === "true";
  const data = await getDashboardData({ demo: demoMode });

  return (
    <main className="min-h-screen bg-zinc-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-700">
              <ShieldCheck className="h-3.5 w-3.5" />
              Santo AI OS
            </div>
            <h1 className="mt-1 text-2xl font-bold text-zinc-900">Panel de operaciones</h1>
          </div>
          <div className="flex items-center gap-2">
            {data.userEmail && <span className="text-xs text-zinc-700">{data.userEmail}</span>}
            <Link
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50"
              href={demoMode ? "/" : "/?demo=1"}
            >
              {demoMode ? "← Salir del demo" : "Ver demostración"}
            </Link>
            {!data.userEmail && data.status !== "demo" && (
              <Link
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
                href="/auth/sign-in"
              >
                Iniciar sesión
              </Link>
            )}
            {data.userEmail && (
              <Link
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50"
                href="/reviews"
              >
                Revisiones
              </Link>
            )}
          </div>
        </header>

        {/* Banner */}
        <SystemBanner data={data} />

        {/* Content */}
        {demoMode || data.status === "demo" ? <DemoView /> : <LiveView data={data} />}
      </div>
    </main>
  );
}
