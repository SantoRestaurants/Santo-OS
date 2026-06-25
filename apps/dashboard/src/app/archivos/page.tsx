import { AlertTriangle, Building2, ChevronRight, FileSpreadsheet, FolderOpen, Landmark, UploadCloud } from "lucide-react";
import Link from "next/link";

import { uploadForecast } from "@/app/cortes/actions";
import { docName, extractDateFromDocument, extractMonthFromDocument } from "@/lib/corte-dashboard-utils";
import { getFileData, type DriveDocument } from "@/lib/file-data";

type SearchParams = Promise<{ month?: string; day?: string; success?: string; error?: string }>;

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const PAPER = "#fbfaf7";
const PANEL = "#ffffff";
const GOLD = "#e8463b";
const AMBER = "#b8782d";
const RED = "#b84a3a";
const GREEN = "#2e7d55";

function monthLabel(key: string) {
  const date = new Date(`${key}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(date);
}

function dayLabel(key: string) {
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "2-digit", month: "short" }).format(date);
}

function groupDocs(docs: DriveDocument[]) {
  return [
    { key: "corte", label: "Corte", icon: FileSpreadsheet, docs: docs.filter((doc) => ["corte_excel", "daily_sales_report", "revision_report", "email_attachment"].includes(doc.document_type) && docName(doc).toLowerCase().includes("corte")) },
    { key: "bancos", label: "Bancos", icon: Landmark, docs: docs.filter((doc) => ["amex_statement", "banorte_statement"].includes(doc.document_type) || /amex|bancaria|banorte/i.test(docName(doc))) },
    { key: "excel", label: "Excel", icon: Building2, docs: docs.filter((doc) => ["income_workbook", "ingresos_workbook"].includes(doc.document_type) || /ingresos|descuentos/i.test(docName(doc))) },
    { key: "evidencia", label: "Evidencia", icon: FolderOpen, docs: docs.filter((doc) => doc.document_type === "daily_folder" || (!isInKnownDailyGroup(doc) && doc.document_type !== "daily_folder")) },
  ];
}

function isInKnownDailyGroup(doc: DriveDocument) {
  const name = docName(doc).toLowerCase();
  return ["corte_excel", "daily_sales_report", "revision_report", "amex_statement", "banorte_statement", "income_workbook", "ingresos_workbook"].includes(doc.document_type)
    || /corte|amex|bancaria|banorte|ingresos|descuentos/i.test(name);
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
        <Link key={month} href={`/archivos?month=${month}`} className="shrink-0 rounded-md border px-3 py-2 text-sm" style={{ borderColor: selected === month ? GOLD : LINE, background: selected === month ? "#fdf2f2" : PANEL, color: selected === month ? GOLD : INK }}>
          {monthLabel(month)}
        </Link>
      ))}
    </div>
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
          <p className="mt-1 text-sm" style={{ color: MUTED }}>El forecast se sube una vez al mes y queda arriba del mes, no dentro de un día.</p>
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

function ForecastPanel({ month, docs }: { month: string; docs: DriveDocument[] }) {
  if (docs.length === 0) return <ForecastUpload month={month} />;
  return (
    <section className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
      <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: INK }}>
        <FileSpreadsheet className="h-4 w-4" />
        Forecast del mes
      </div>
      <FileList docs={docs} />
    </section>
  );
}

function FileList({ docs }: { docs: DriveDocument[] }) {
  if (docs.length === 0) {
    return <div className="rounded-md border px-3 py-3 text-sm" style={{ borderColor: LINE, color: MUTED }}>Sin archivos registrados.</div>;
  }
  return (
    <div className="space-y-2">
      {docs.map((doc) => (
        <a key={doc.id} href={doc.source_uri ?? "#"} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm" style={{ borderColor: LINE, color: INK, pointerEvents: doc.source_uri ? "auto" : "none" }}>
          <div className="min-w-0">
            <div className="truncate font-semibold">{docName(doc)}</div>
            <div className="text-xs" style={{ color: MUTED }}>{doc.document_type} · {doc.status}</div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0" />
        </a>
      ))}
    </div>
  );
}

function DayFolders({ selectedMonth, selectedDay, dayDocs }: { selectedMonth: string; selectedDay: string; dayDocs: Map<string, DriveDocument[]> }) {
  const days = Array.from(dayDocs.keys()).sort().reverse();
  const docs = dayDocs.get(selectedDay) ?? [];
  const folders = groupDocs(docs);
  return (
    <section className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div>
        <div className="mb-3 font-semibold">Días</div>
        <div className="rounded-md border" style={{ borderColor: LINE, background: PANEL }}>
          {days.map((day) => (
            <Link key={day} href={`/archivos?month=${selectedMonth}&day=${day}`} className="block border-b px-4 py-3 text-sm last:border-b-0" style={{ borderColor: LINE, background: day === selectedDay ? "#fff8df" : PANEL, color: day === selectedDay ? GOLD : INK }}>
              <div className="font-semibold">{dayLabel(day)}</div>
              <div className="text-xs" style={{ color: MUTED }}>{dayDocs.get(day)?.length ?? 0} archivos</div>
            </Link>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {folders.map((folder) => {
          const Icon = folder.icon;
          return (
            <section key={folder.key} className="rounded-md border p-4" style={{ borderColor: LINE, background: PANEL }}>
              <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: INK }}>
                <Icon className="h-4 w-4" />
                {folder.label}
              </div>
              <FileList docs={folder.docs} />
            </section>
          );
        })}
      </div>
    </section>
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

  if (data.status === "unauthorized") {
    return (
      <main className="flex min-h-screen items-center justify-center flex-col gap-4" style={{ background: PAPER, color: INK }}>
        <div className="text-xl font-bold">Acceso Denegado</div>
        <div className="text-sm">Necesitas permisos de supervisor para ver este panel.</div>
        <Link href="/auth/sign-in" className="rounded-md px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "white" }}>Volver al login</Link>
      </main>
    );
  }

  const months = Array.from(new Set(data.documents.map(extractMonthFromDocument))).sort().reverse();
  const selectedMonth = params.month && months.includes(params.month) ? params.month : months[0] ?? new Date().toISOString().slice(0, 7);
  const docs = data.documents.filter((doc) => extractMonthFromDocument(doc) === selectedMonth);
  const forecastDocs = docs.filter((doc) => doc.document_type === "forecast_workbook");
  const dailyDocs = docs.filter((doc) => doc.document_type !== "forecast_workbook" && extractDateFromDocument(doc));
  const byDay = dailyDocs.reduce((map, doc) => {
    const day = extractDateFromDocument(doc);
    if (!day) return map;
    const current = map.get(day) ?? [];
    current.push(doc);
    map.set(day, current);
    return map;
  }, new Map<string, DriveDocument[]>());
  const days = Array.from(byDay.keys()).sort().reverse();
  const selectedDay = params.day && byDay.has(params.day) ? params.day : days[0] ?? "";

  return (
    <main className="min-h-screen" style={{ background: PAPER, color: INK }}>
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="pl-10 lg:pl-0">
          <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: GOLD }}>Archivos</div>
          <h1 className="mt-1 text-3xl font-semibold">Drive de cortes</h1>
          <p className="mt-2 max-w-3xl text-sm" style={{ color: MUTED }}>
            Primero el forecast mensual. Después, cada día con su corte, bancos, Excel y evidencia.
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

        <ForecastPanel month={selectedMonth} docs={forecastDocs} />

        {days.length > 0 ? (
          <DayFolders selectedMonth={selectedMonth} selectedDay={selectedDay} dayDocs={byDay} />
        ) : (
          <div className="rounded-md border p-8 text-center text-sm" style={{ borderColor: LINE, background: PANEL, color: MUTED }}>No hay archivos diarios registrados para este mes.</div>
        )}
      </div>
    </main>
  );
}
