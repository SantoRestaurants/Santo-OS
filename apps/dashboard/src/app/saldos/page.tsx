import { AlertTriangle, Clock, Building2, Save } from "lucide-react";
import Link from "next/link";
import { getReconciliationData } from "@/lib/reconciliation-data";
import { getMonthlyTotals, dedupeRunsByDay } from "@/lib/corte-dashboard-utils";

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const PAPER = "#fbfaf7";
const PANEL = "#ffffff";
const GOLD = "#e8463b";

function money(value: number | undefined | null) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(value);
}

export default async function SaldosPage() {
  const data = await getReconciliationData();

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

  const allRuns = data.runs.filter((run) => run.business_date);
  const runs = dedupeRunsByDay(allRuns);
  
  // Get latest run for current balances
  const latestRun = runs[0];
  const saldos = latestRun?.output_payload?.saldos as Record<string, number> | undefined;

  return (
    <main className="min-h-screen" style={{ background: PAPER, color: INK }}>
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="pl-10 lg:pl-0">
          <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>Gestión</div>
          <h1 className="mt-1 text-3xl font-semibold">Saldos Acumulados</h1>
          <p className="mt-2 text-sm" style={{ color: MUTED }}>
            Control de provisiones y saldos históricos.
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

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-md border p-5" style={{ borderColor: LINE, background: PANEL }}>
            <div className="mb-4 flex items-center gap-2 font-semibold text-lg" style={{ color: INK }}>
              <Building2 className="h-5 w-5" />
              Saldos Cuentas (Automático)
            </div>
            <p className="text-sm mb-6" style={{ color: MUTED }}>Saldos reportados en el último corte ({latestRun?.business_date || "N/A"}). Se actualizan con los archivos del banco.</p>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 rounded-md border bg-gray-50" style={{ borderColor: LINE }}>
                <span className="font-medium">Banorte</span>
                <span className="font-bold">{money(saldos?.banorte || 0)}</span>
              </div>
              <div className="flex justify-between items-center p-3 rounded-md border bg-gray-50" style={{ borderColor: LINE }}>
                <span className="font-medium">AMEX</span>
                <span className="font-bold">{money(saldos?.amex || 0)}</span>
              </div>
              <div className="flex justify-between items-center p-3 rounded-md border bg-gray-50" style={{ borderColor: LINE }}>
                <span className="font-medium">Efectivo en Caja</span>
                <span className="font-bold">{money(saldos?.efectivo || 0)}</span>
              </div>
            </div>
          </section>

          <section className="rounded-md border p-5" style={{ borderColor: LINE, background: PANEL }}>
            <div className="mb-4 flex items-center gap-2 font-semibold text-lg" style={{ color: INK }}>
              <Save className="h-5 w-5" />
              Provisiones (Manual)
            </div>
            <p className="text-sm mb-6" style={{ color: MUTED }}>Modificá las provisiones. Cada cambio quedará registrado en el historial.</p>
            
            <form action="/saldos/api/update" method="POST" className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: INK }}>Fondo Aguinaldos</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm" style={{ color: MUTED }}>$</span>
                  <input 
                    type="number" 
                    name="aguinaldos" 
                    defaultValue={saldos?.aguinaldos || 0}
                    className="w-full rounded-md border pl-7 pr-3 py-2 text-sm" 
                    style={{ borderColor: LINE }} 
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: INK }}>Fondo Utilidades</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm" style={{ color: MUTED }}>$</span>
                  <input 
                    type="number" 
                    name="utilidades" 
                    defaultValue={saldos?.utilidades || 0}
                    className="w-full rounded-md border pl-7 pr-3 py-2 text-sm" 
                    style={{ borderColor: LINE }} 
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: INK }}>Motivo de ajuste</label>
                <input 
                  type="text" 
                  name="note" 
                  placeholder="Ej: Aporte quincenal"
                  className="w-full rounded-md border px-3 py-2 text-sm" 
                  style={{ borderColor: LINE }} 
                />
              </div>

              <button type="button" className="w-full rounded-md px-4 py-2 text-sm font-semibold mt-2" style={{ background: GOLD, color: "white" }}>
                Actualizar Provisiones
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
