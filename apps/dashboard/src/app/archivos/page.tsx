import { AlertTriangle, Building2, ChevronRight, FileSpreadsheet, FolderOpen, Landmark, UploadCloud } from "lucide-react";
import Link from "next/link";

import { uploadForecast } from "@/app/cortes/actions";
import { getFileData, type DriveDocument } from "@/lib/file-data";

type SearchParams = Promise<{ month?: string; success?: string; error?: string }>;

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const PAPER = "#fbfaf7";
const PANEL = "#ffffff";
const GOLD = "#9b7a22";
const AMBER = "#b8782d";
const RED = "#b84a3a";
const GREEN = "#2e7d55";

function parseMonth(doc: DriveDocument) {
  const explicit = String(doc.metadata?.month ?? "");
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
  const relation = doc.workflow_runs;
  const date = Array.isArray(relation) ? relation[0]?.business_date : relation?.business_date;
  if (date) return date.slice(0, 7);
  return doc.created_at.slice(0, 7);
}

function monthLabel(key: string) {
  const date = new Date(`${key}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(date);
}

function docName(doc: DriveDocument) {
  return String(doc.metadata?.name ?? doc.metadata?.original_filename ?? doc.document_key ?? doc.document_type);
}

function groupDocs(docs: DriveDocument[]) {
  return [
    { key: "cortes", label: "Cortes", icon: FileSpreadsheet, docs: docs.filter((doc) => ["corte_excel", "daily_sales_report", "revision_report"].includes(doc.document_type)) },
    { key: "bancos", label: "Bancos", icon: Landmark, docs: docs.filter((doc) => ["amex_statement", "banorte_statement"].includes(doc.document_type)) },
    { key: "excels", label: "Excel mensual", icon: Building2, docs: docs.filter((doc) => ["income_workbook", "ingresos_workbook", "forecast_workbook"].includes(doc.document_type) || docName(doc).toLowerCase().includes("ingresos")) },
    { key: "evidencia", label: "Evidencia", icon: FolderOpen, docs: docs.filter((doc) => !["corte_excel", "daily_sales_report", "revision_report", "amex_statement", "banorte_statement", "forecast_workbook"].includes(doc.document_type)) },
  ];
}

function Flash({ success, error }: { success?: string; error?: string }) {
  if (!success && !error) return null;
  return (
    <div className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: error ? "#e8b4aa" : "#b8dbc9", background: error ? "#fff4f1" : "#f1fbf5", color: error ? RED : GREEN }}>
      {error ? decodeURIComponent(error) : "Archivo registrado."}
    </div>
  );
}

function MonthNav({ months, selected }: { months: string[]; selected: string }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {months.map((month) => (
        <Link key={month} href={`/archivos?month=${month}`} className="shrink-0 rounded-md border px-3 py-2 text-sm" style={{ borderColor: selected === month ? GOLD : LINE, background: selected === month ? "#fff8df" : PANEL, color: selected === month ? GOLD : INK }}>
          {monthLabel(month)}
        </Link>
      ))}
    </div>
  );
}

function FolderSection({ label, docs, icon: Icon }: { label: string; docs: DriveDocument[]; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <section className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
      <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: INK }}>
        <Icon className="h-4 w-4" />
        {label}
      </div>
      {docs.length === 0 ? (
        <div className="rounded-md border px-3 py-3 text-sm" style={{ borderColor: LINE, color: MUTED }}>
          Sin archivos registrados.
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <a key={doc.id} href={doc.source_uri ?? "#"} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm" style={{ borderColor: LINE, color: INK, pointerEvents: doc.source_uri ? "auto" : "none" }}>
              <div>
                <div className="font-semibold">{docName(doc)}</div>
                <div className="text-xs" style={{ color: MUTED }}>{doc.document_type} · {doc.status}</div>
              </div>
              <ChevronRight className="h-4 w-4" />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function ForecastUpload({ month }: { month: string }) {
  return (
    <form action={uploadForecast} className="rounded-md border p-4" style={{ borderColor: "#e4c58f", background: "#fff8ec" }}>
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="returnTo" value={`/archivos?month=${month}`} />
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5" style={{ color: AMBER }} />
        <div>
          <div className="font-semibold" style={{ color: INK }}>Falta forecast de {monthLabel(month)}</div>
          <p className="mt-1 text-sm" style={{ color: MUTED }}>El forecast se sube una vez al mes y queda guardado para todos los cortes de ese mes.</p>
          <input name="forecastFile" type="file" accept=".xlsx,.xls" className="mt-3 block w-full text-sm" style={{ color: MUTED }} />
          <button className="mt-3 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>
            <UploadCloud className="h-4 w-4" />
            Subir forecast
          </button>
        </div>
      </div>
    </form>
  );
}

export default async function ArchivosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = await getFileData();

  if (data.status === "auth_required") {
    return (
      <main className="flex min-h-screen items-center justify-center" style={{ background: PAPER }}>
        <Link href="/auth/sign-in" className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>Iniciar sesión</Link>
      </main>
    );
  }

  const months = Array.from(new Set(data.documents.map(parseMonth))).sort().reverse();
  const selectedMonth = params.month && months.includes(params.month) ? params.month : months[0] ?? new Date().toISOString().slice(0, 7);
  const docs = data.documents.filter((doc) => parseMonth(doc) === selectedMonth);
  const forecastDocs = docs.filter((doc) => doc.document_type === "forecast_workbook");
  const folders = groupDocs(docs);

  return (
    <main className="min-h-screen" style={{ background: PAPER, color: INK }}>
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="pl-10 lg:pl-0">
          <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>Archivos</div>
          <h1 className="mt-1 text-3xl font-semibold">Drive de cortes</h1>
          <p className="mt-2 max-w-3xl text-sm" style={{ color: MUTED }}>
            Vista simple de la carpeta de cortes: bancos, Excel mensual, forecast y evidencia registrada por SantoOS.
          </p>
        </header>

        <Flash success={params.success} error={params.error} />

        {data.status === "requires_config" && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: "#e4c58f", background: "#fff8ec", color: AMBER }}>
            Falta conectar Supabase: {data.missingConfig.join(", ")}
          </div>
        )}
        {data.error && (
          <div className="rounded-md border p-4 text-sm" style={{ borderColor: "#e8b4aa", background: "#fff4f1", color: RED }}>{data.error}</div>
        )}

        <section className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
          <div className="mb-3 font-semibold">Mes</div>
          <MonthNav months={months.length ? months : [selectedMonth]} selected={selectedMonth} />
        </section>

        {forecastDocs.length === 0 && <ForecastUpload month={selectedMonth} />}

        <div className="grid gap-4 md:grid-cols-2">
          {folders.map((folder) => (
            <FolderSection key={folder.key} label={folder.label} docs={folder.docs} icon={folder.icon} />
          ))}
        </div>
      </div>
    </main>
  );
}
