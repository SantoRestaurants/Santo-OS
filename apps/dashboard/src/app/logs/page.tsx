import { AlertTriangle, Clock, Info, AlertCircle, FileText } from "lucide-react";
import Link from "next/link";
import { getLogsData } from "@/lib/logs-data";

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const PAPER = "#fbfaf7";
const PANEL = "#ffffff";
const GOLD = "#e8463b";

function formatDate(dateString: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateString));
}

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case "error":
    case "critical":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "info":
    default:
      return <Info className="h-4 w-4 text-blue-500" />;
  }
}

export default async function LogsPage() {
  const data = await getLogsData();

  if (data.status === "auth_required") {
    return (
      <main className="flex min-h-screen items-center justify-center" style={{ background: PAPER }}>
        <Link href="/auth/sign-in" className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>Iniciar sesión</Link>
      </main>
    );
  }

  if (data.status === "unauthorized") {
    return (
      <main className="flex min-h-screen items-center justify-center flex-col gap-4" style={{ background: PAPER, color: INK }}>
        <div className="text-xl font-bold">Acceso Denegado</div>
        <div className="text-sm">Necesitas permisos de supervisor para ver este panel.</div>
        <Link href="/auth/sign-in" className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>Volver al login</Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: PAPER, color: INK }}>
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="pl-10 lg:pl-0">
          <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>Auditoría</div>
          <h1 className="mt-1 text-3xl font-semibold">Registro de Eventos</h1>
          <p className="mt-2 text-sm" style={{ color: MUTED }}>
            Historial de acciones manuales y del sistema.
          </p>
        </header>

        {data.status === "requires_config" && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: "#e4c58f", background: "#fff8ec", color: "#b8782d" }}>
            Falta conectar Supabase: {data.missingConfig.join(", ")}
          </div>
        )}
        
        {data.error && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: "#e8b4aa", background: "#fff4f1", color: "#b84a3a" }}>
            {data.error}
          </div>
        )}

        <div className="rounded-md border bg-white" style={{ borderColor: LINE }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ borderBottom: `1px solid ${LINE}` }}>
                <tr>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: MUTED }}>Fecha</th>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: MUTED }}>Tipo</th>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: MUTED }}>Usuario/Sistema</th>
                  <th className="px-4 py-3 text-left font-semibold" style={{ color: MUTED }}>Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: LINE }}>
                {data.events.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center" style={{ color: MUTED }}>
                      <Clock className="mx-auto mb-2 h-6 w-6 opacity-50" />
                      No hay eventos registrados
                    </td>
                  </tr>
                ) : (
                  data.events.map((event) => (
                    <tr key={event.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 align-top whitespace-nowrap">
                        {formatDate(event.created_at)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center gap-1.5">
                          <SeverityIcon severity={event.severity} />
                          <span className="font-medium">{event.event_type}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top" style={{ color: MUTED }}>
                        {String(event.payload?.created_by_email || event.payload?.uploaded_by_email || "Sistema")}
                      </td>
                      <td className="px-4 py-3 align-top max-w-sm">
                        {event.event_type === "corte.manual_value_corrected" && (
                          <div>
                            <div className="font-semibold">{String(event.payload?.field)} &rarr; {String(event.payload?.value)}</div>
                            {!!event.payload?.note && <div className="text-xs mt-1" style={{ color: MUTED }}>Nota: {String(event.payload.note)}</div>}
                          </div>
                        )}
                        {event.event_type === "corte.dashboard_comment_added" && (
                          <div className="truncate">{String(event.payload?.comment)}</div>
                        )}
                        {event.event_type === "forecast.uploaded" && (
                          <div>Forecast mensual subido para {String(event.payload?.month)}</div>
                        )}
                        {!["corte.manual_value_corrected", "corte.dashboard_comment_added", "forecast.uploaded"].includes(event.event_type) && (
                          <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap max-h-20" style={{ color: MUTED }}>
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
