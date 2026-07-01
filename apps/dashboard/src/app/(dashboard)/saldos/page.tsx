import { Building2, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { getReconciliationData } from "@/lib/reconciliation-data";
import { dedupeRunsByDay } from "@/lib/corte-dashboard-utils";

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const PAPER = "#fbfaf7";
const PANEL = "#ffffff";
const GOLD = "#e8463b";
const GREEN = "#16a34a";

function money(value: number | undefined | null) {
  if (value == null || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(value);
}

type SearchParams = Promise<{ success?: string; error?: string }>;

export default async function SaldosPage({ searchParams }: { searchParams: SearchParams }) {
  const { success, error } = await searchParams;
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
  
  // Find latest run that actually has saldos data
  const latestRun = runs.find((run) => {
    const s = (run.output_payload?.saldos as Record<string, number> | undefined);
    return s && Object.values(s).some((v) => v > 0);
  }) || runs[0];
  const saldos = (latestRun?.output_payload?.saldos as Record<string, number> | undefined) ?? {};

  const fields = [
    { key: "banorte", label: "Banorte", hint: "Automático — del archivo de banco" },
    { key: "aguinaldos", label: "Fondo Aguinaldos", hint: "Manual" },
    { key: "utilidades", label: "Fondo Utilidades", hint: "Manual" },
  ];

  return (
    <main className="min-h-screen" style={{ background: PAPER, color: INK }}>
      <div className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="pl-10 lg:pl-0">
          <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>Gestión</div>
          <h1 className="mt-1 text-3xl font-semibold">Saldos Acumulados</h1>
          <p className="mt-2 text-sm" style={{ color: MUTED }}>
            Último corte: {latestRun?.business_date || "N/A"} — modificá cualquier saldo manualmente.
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

        {success && (
          <div className="flex items-center gap-2 rounded-md border p-3 text-sm" style={{ borderColor: "#bbf7d0", background: "#f0fdf4", color: GREEN }}>
            <CheckCircle2 className="h-4 w-4" />
            Saldos actualizados correctamente.
          </div>
        )}

        {error && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: "#e8b4aa", background: "#fff4f1", color: "#b84a3a" }}>
            Error: {error}
          </div>
        )}

        <form action="/saldos/api/update" method="POST" className="rounded-md border p-6" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-5 flex items-center gap-2 font-semibold text-lg" style={{ color: INK }}>
            <Building2 className="h-5 w-5" />
            Editar Saldos
          </div>

          <div className="space-y-4">
            {fields.map((f) => (
              <div key={f.key}>
                <label className="block text-sm font-medium mb-1" style={{ color: INK }}>
                  {f.label}
                  <span className="ml-1 text-xs font-normal" style={{ color: MUTED }}>({f.hint})</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm" style={{ color: MUTED }}>$</span>
                  <input
                    type="number"
                    step="0.01"
                    name={f.key}
                    defaultValue={saldos[f.key] || ""}
                    className="w-full rounded-md border pl-7 pr-3 py-2 text-sm font-medium"
                    style={{ borderColor: LINE }}
                    placeholder="0.00"
                  />
                </div>
              </div>
            ))}

            <div>
              <label className="block text-sm font-medium mb-1" style={{ color: INK }}>Motivo de ajuste</label>
              <input
                type="text"
                name="note"
                placeholder="Ej: Ajuste mensual, cierre de caja"
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: LINE }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="mt-6 w-full rounded-md px-4 py-2.5 text-sm font-semibold transition hover:opacity-90"
            style={{ background: GOLD, color: "white" }}
          >
            Guardar cambios
          </button>
        </form>
      </div>
    </main>
  );
}
