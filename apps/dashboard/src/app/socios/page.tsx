import { getReconciliationData, type ReconciliationRun } from "@/lib/reconciliation-data";
import { dailyForecastMeta, dailySales, dedupeRunsByDay, getMonthlyTotals } from "@/lib/corte-dashboard-utils";
import Link from "next/link";
import Image from "next/image";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ month?: string; week?: string; day?: string }>;

/* ── helpers ─────────────────────────────────────────────────────────── */

function money(v: number | undefined | null) {
  if (v == null || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(v);
}

function moneyFull(v: number | undefined | null) {
  if (v == null || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(v);
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthKey(date: string | null | undefined) {
  return date ? date.slice(0, 7) : "sin-fecha";
}

function weekKey(date: string | null | undefined) {
  const parsed = parseDate(date);
  if (!parsed) return "sin-semana";
  const d = new Date(parsed);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function dateLabel(value: string | null | undefined, mode: "short" | "long" = "long") {
  const parsed = parseDate(value);
  if (!parsed) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    weekday: mode === "long" ? "long" : "short",
    day: "2-digit",
    month: mode === "long" ? "long" : "short",
    year: mode === "long" ? "numeric" : undefined,
  }).format(parsed);
}

function monthLabel(key: string) {
  const d = parseDate(`${key}-01`);
  if (!d) return key;
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(d);
}

function runTotal(run: ReconciliationRun) { return dailySales(run); }
function runMeta(run: ReconciliationRun) { return dailyForecastMeta(run); }
function runDiff(run: ReconciliationRun) { const m = runMeta(run); return m == null ? null : runTotal(run) - m; }

function isBankValidated(run: ReconciliationRun) {
  return run.status === "completed" || run.status === "bank_validated" || run.documents.some(d => d.document_type === "amex_statement" || d.document_type === "banorte_statement");
}

function statusLabel(run: ReconciliationRun) {
  if (isBankValidated(run)) return "Validado";
  if (run.status === "requires_review") return "Revisión";
  if (run.status === "waiting_for_input") return "Pendiente";
  if (run.status === "completed") return "Cargado";
  return run.status;
}

/* ── colors ──────────────────────────────────────────────────────────── */

const C = {
  bg: "#141214",
  surface: "#1c1a1e",
  surfaceHover: "#242226",
  border: "rgba(255,255,255,0.07)",
  borderActive: "rgba(232,70,59,0.5)",
  ink: "#e8e4df",
  dim: "#8a837a",
  faint: "#524e49",
  santo: "#e8463b",
  santoGlow: "rgba(232,70,59,0.15)",
  green: "#4ade80",
  greenDim: "rgba(74,222,128,0.12)",
  red: "#f87171",
  redDim: "rgba(248,113,113,0.12)",
  amber: "#fbbf24",
  amberDim: "rgba(251,191,36,0.12)",
};

/* ── page ────────────────────────────────────────────────────────────── */

export default async function SociosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = await getReconciliationData(true);

  if (data.status === "requires_config") {
    return (
      <main style={{ background: C.bg, color: C.ink, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-geist-mono), monospace" }}>
        <div style={{ textAlign: "center", opacity: 0.5 }}>Configuración pendiente</div>
      </main>
    );
  }

  const allRuns = data.runs.filter(r => r.business_date);
  const runs = dedupeRunsByDay(allRuns);

  /* navigation state */
  const monthsArr = Array.from(new Set(runs.map(r => monthKey(r.business_date)))).sort().reverse();
  const todayMonth = new Date().toISOString().slice(0, 7);
  if (!monthsArr.includes(todayMonth)) monthsArr.unshift(todayMonth);

  const selectedMonth = params.month && monthsArr.includes(params.month) ? params.month : monthsArr[0];
  const monthRuns = runs.filter(r => monthKey(r.business_date) === selectedMonth);
  const { monthTotal, monthMeta } = getMonthlyTotals(monthRuns, selectedMonth || "");
  const monthDiff = monthMeta ? monthTotal - monthMeta : null;
  const monthProgress = monthMeta ? Math.min((monthTotal / monthMeta) * 100, 100) : 0;

  const weeks = Array.from(new Set(monthRuns.map(r => weekKey(r.business_date)))).sort();
  const selectedWeek = params.week && weeks.includes(params.week) ? params.week : weeks[weeks.length - 1] ?? "sin-semana";
  const weekRuns = monthRuns.filter(r => weekKey(r.business_date) === selectedWeek).sort((a, b) => String(a.business_date).localeCompare(String(b.business_date)));

  const selectedRun = weekRuns.find(r => r.id === params.day) ?? weekRuns[weekRuns.length - 1] ?? null;

  const latestRun = runs[0];
  const saldos = latestRun?.output_payload?.saldos as Record<string, number> | undefined;

  const hp = (p: Record<string, string>) => {
    const u = new URLSearchParams(p);
    return `/socios?${u.toString()}`;
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        body { background: ${C.bg} !important; color: ${C.ink} !important; margin: 0; }
        .socios-root { font-family: var(--font-geist-sans), -apple-system, sans-serif; min-height: 100vh; }
        .socios-root * { box-sizing: border-box; }
        a { text-decoration: none; color: inherit; }

        .grain { position: fixed; inset: 0; pointer-events: none; opacity: 0.03; z-index: 100;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E");
        }

        .month-pill { display: inline-block; padding: 8px 16px; font-size: 13px; font-weight: 600;
          border: 1px solid ${C.border}; background: ${C.surface}; color: ${C.dim};
          transition: all 0.15s ease; cursor: pointer; }
        .month-pill:hover { background: ${C.surfaceHover}; color: ${C.ink}; }
        .month-pill.active { background: ${C.santoGlow}; border-color: ${C.borderActive}; color: ${C.santo}; }

        .week-card { padding: 12px 16px; border: 1px solid ${C.border}; background: ${C.surface};
          transition: all 0.15s ease; cursor: pointer; }
        .week-card:hover { background: ${C.surfaceHover}; border-color: rgba(255,255,255,0.12); }
        .week-card.active { border-color: ${C.borderActive}; background: ${C.santoGlow}; }

        .day-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px;
          border-bottom: 1px solid ${C.border}; transition: all 0.12s ease; cursor: pointer; }
        .day-row:last-child { border-bottom: none; }
        .day-row:hover { background: ${C.surfaceHover}; }
        .day-row.active { background: ${C.santoGlow}; border-left: 2px solid ${C.santo}; }

        .kpi-card { padding: 20px; background: ${C.surface}; border: 1px solid ${C.border}; }
        .kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: ${C.dim}; margin-bottom: 6px; }
        .kpi-value { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: ${C.ink}; font-variant-numeric: tabular-nums; }
        .kpi-value.santo { color: ${C.santo}; }

        .data-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0;
          border-bottom: 1px solid ${C.border}; font-size: 13px; }
        .data-row:last-child { border-bottom: none; }
        .data-row-label { color: ${C.dim}; }
        .data-row-value { font-weight: 600; color: ${C.ink}; font-variant-numeric: tabular-nums; }

        .status-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px;
          font-weight: 600; padding: 4px 10px; border-radius: 4px; }

        .progress-track { height: 3px; background: ${C.faint}; position: relative; overflow: hidden; border-radius: 2px; }
        .progress-fill { position: absolute; left: 0; top: 0; bottom: 0; background: ${C.santo};
          border-radius: 2px; transition: width 0.6s ease; }

        @media (max-width: 768px) {
          .socios-grid { grid-template-columns: 1fr !important; }
          .detail-grid { grid-template-columns: 1fr !important; }
          .kpi-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}} />

      <div className="grain" />

      <div className="socios-root">
        {/* ── HEADER ─────────────────────────────────────── */}
        <header style={{ padding: "24px 32px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <Image src="/logo.png" alt="Santo" width={40} height={40} style={{ filter: "brightness(1.1)" }} />
            <div>
              <div style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "-0.01em" }}>Santo</div>
              <div style={{ fontSize: "11px", color: C.dim, letterSpacing: "0.04em" }}>Panel de Socios · Solo lectura</div>
            </div>
          </div>
          <div style={{ fontSize: "12px", color: C.faint, fontVariantNumeric: "tabular-nums" }}>
            {new Date().toLocaleDateString("es-MX", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
          </div>
        </header>

        <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "24px 32px" }}>

          {/* ── MONTH SELECTOR ───────────────────────────── */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "24px" }}>
            {monthsArr.slice(0, 6).map(m => {
              const d = parseDate(`${m}-01`);
              const label = d ? new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(d) : m;
              return (
                <Link key={m} href={hp({ month: m })} className={`month-pill ${m === selectedMonth ? "active" : ""}`}>
                  {label.charAt(0).toUpperCase() + label.slice(1)}
                </Link>
              );
            })}
          </div>

          {/* ── MONTH KPIs ───────────────────────────────── */}
          <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "8px" }}>
            <div className="kpi-card">
              <div className="kpi-label">Venta del mes</div>
              <div className="kpi-value santo">{money(monthTotal)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Meta / Forecast</div>
              <div className="kpi-value">{money(monthMeta)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Diferencia</div>
              <div className="kpi-value" style={{ color: monthDiff == null ? C.dim : monthDiff >= 0 ? C.green : C.red }}>
                {monthDiff == null ? "—" : `${monthDiff >= 0 ? "+" : ""}${moneyFull(monthDiff)}`}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Cortes registrados</div>
              <div className="kpi-value">{monthRuns.length}</div>
            </div>
          </div>

          {/* ── progress bar ─ */}
          <div style={{ marginBottom: "28px", padding: "0 0 4px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: C.dim, marginBottom: "6px" }}>
              <span>Progreso hacia meta</span>
              <span>{monthProgress.toFixed(1)}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${monthProgress}%` }} />
            </div>
          </div>

          {/* ── WEEK SELECTOR ────────────────────────────── */}
          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: C.dim, marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Semanas</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(weeks.length || 1, 5)}, 1fr)`, gap: "8px" }}>
              {weeks.length === 0 ? (
                <div className="week-card" style={{ color: C.faint }}>Sin semanas</div>
              ) : weeks.map((w, i) => {
                const wRuns = monthRuns.filter(r => weekKey(r.business_date) === w);
                const wTotal = wRuns.reduce((sum, r) => sum + runTotal(r), 0);
                return (
                  <Link key={w} href={hp({ month: selectedMonth || "", week: w })} className={`week-card ${w === selectedWeek ? "active" : ""}`}>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em" }}>Semana {i + 1}</div>
                    <div style={{ fontSize: "16px", fontWeight: 700, marginTop: "4px" }}>{money(wTotal)}</div>
                    <div style={{ fontSize: "11px", color: C.faint, marginTop: "2px" }}>{wRuns.length} día{wRuns.length !== 1 ? "s" : ""}</div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* ── DAY LIST + DETAIL ────────────────────────── */}
          <div className="socios-grid" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "16px" }}>

            {/* day list */}
            <div style={{ border: `1px solid ${C.border}`, background: C.surface }}>
              <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, fontSize: "13px", fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Días
              </div>
              {weekRuns.length === 0 ? (
                <div style={{ padding: "24px 16px", fontSize: "13px", color: C.faint, textAlign: "center" }}>Sin cortes esta semana</div>
              ) : weekRuns.map(run => {
                const diff = runDiff(run);
                const active = selectedRun?.id === run.id;
                const validated = isBankValidated(run);
                return (
                  <Link key={run.id} href={hp({ month: selectedMonth || "", week: selectedWeek, day: run.id })} className={`day-row ${active ? "active" : ""}`}>
                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 600 }}>{dateLabel(run.business_date, "short")}</div>
                      <div style={{ marginTop: "4px" }}>
                        <span className="status-badge" style={{
                          background: validated ? C.greenDim : C.amberDim,
                          color: validated ? C.green : C.amber,
                        }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "currentColor" }} />
                          {statusLabel(run)}
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "15px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(runTotal(run))}</div>
                      {diff != null && (
                        <div style={{ fontSize: "12px", fontWeight: 600, color: diff >= 0 ? C.green : C.red, marginTop: "2px" }}>
                          {diff >= 0 ? "+" : ""}{((diff / (runMeta(run) || 1)) * 100).toFixed(1)}%
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* detail panel */}
            {selectedRun ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* header card */}
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: "24px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: C.santo, textTransform: "uppercase", letterSpacing: "0.08em" }}>Detalle del día</div>
                      <div style={{ fontSize: "24px", fontWeight: 700, marginTop: "4px" }}>{dateLabel(selectedRun.business_date)}</div>
                    </div>
                    <span className="status-badge" style={{
                      background: isBankValidated(selectedRun) ? C.greenDim : C.amberDim,
                      color: isBankValidated(selectedRun) ? C.green : C.amber,
                      fontSize: "12px", padding: "6px 14px",
                    }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "currentColor" }} />
                      {statusLabel(selectedRun)}
                    </span>
                  </div>

                  <div className="detail-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginTop: "20px" }}>
                    <div className="kpi-card" style={{ background: C.surfaceHover }}>
                      <div className="kpi-label">Venta real</div>
                      <div className="kpi-value santo" style={{ fontSize: "22px" }}>{moneyFull(runTotal(selectedRun))}</div>
                    </div>
                    <div className="kpi-card" style={{ background: C.surfaceHover }}>
                      <div className="kpi-label">Meta forecast</div>
                      <div className="kpi-value" style={{ fontSize: "22px" }}>{moneyFull(runMeta(selectedRun))}</div>
                    </div>
                    <div className="kpi-card" style={{ background: C.surfaceHover }}>
                      <div className="kpi-label">Diferencia</div>
                      {(() => {
                        const d = runDiff(selectedRun);
                        const m = runMeta(selectedRun);
                        return (
                          <div className="kpi-value" style={{ fontSize: "22px", color: d == null ? C.dim : d >= 0 ? C.green : C.red }}>
                            {d == null || m == null ? "—" : `${d >= 0 ? "+" : ""}${((d / m) * 100).toFixed(1)}%`}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="kpi-card" style={{ background: C.surfaceHover }}>
                      <div className="kpi-label">Total sistema</div>
                      <div className="kpi-value" style={{ fontSize: "22px" }}>{moneyFull(selectedRun.revision?.reconciliation_totals?.total_sistema)}</div>
                    </div>
                  </div>
                </div>

                {/* venta bruta */}
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: "20px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "14px" }}>Venta Bruta</div>
                  {(() => {
                    const reg = (selectedRun.output_payload?.income_register ?? {}) as Record<string, number>;
                    const ch = (selectedRun.output_payload?.income_channels ?? {}) as Record<string, number>;
                    const channels = [
                      { key: "amex", label: "AMEX" },
                      { key: "debito", label: "Débito" },
                      { key: "credito", label: "Crédito" },
                      { key: "efectivo", label: "Efectivo" },
                      { key: "paypal", label: "PayPal" },
                      { key: "uber", label: "Uber Eats" },
                      { key: "rappi", label: "Rappi" },
                      { key: "propinas", label: "Propinas" },
                    ];
                    return (
                      <div>
                        {channels.map(c => {
                          const val = reg[c.key] ?? ch[c.key] ?? 0;
                          if (val === 0) return null;
                          return (
                            <div key={c.key} className="data-row">
                              <span className="data-row-label">{c.label}</span>
                              <span className="data-row-value">{moneyFull(val)}</span>
                            </div>
                          );
                        })}
                        <div className="data-row" style={{ borderBottom: "none", fontWeight: 700, fontSize: "15px" }}>
                          <span>Total</span>
                          <span style={{ color: C.santo }}>{moneyFull(runTotal(selectedRun))}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* saldos for this day if present */}
                {!!selectedRun.output_payload?.saldos && (
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: "20px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "14px" }}>Saldos al cierre</div>
                    {(() => {
                      const s = selectedRun.output_payload.saldos as Record<string, number>;
                      const rows = [
                        { label: "Banorte", val: s.banorte },
                        { label: "AMEX", val: s.amex },
                        { label: "Efectivo", val: s.efectivo },
                      ];
                      const reserves = [
                        { label: "Utilidades", val: s.utilidades },
                        { label: "Aguinaldos", val: s.aguinaldos },
                      ];
                      return (
                        <>
                          {rows.map(r => (
                            <div key={r.label} className="data-row">
                              <span className="data-row-label">{r.label}</span>
                              <span className="data-row-value">{moneyFull(r.val)}</span>
                            </div>
                          ))}
                          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: "8px", paddingTop: "8px" }}>
                            {reserves.map(r => (
                              <div key={r.label} className="data-row">
                                <span className="data-row-label">{r.label}</span>
                                <span className="data-row-value">{moneyFull(r.val)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: C.surface, border: `1px solid ${C.border}`, padding: "48px", color: C.faint, fontSize: "14px" }}>
                Seleccioná un día para ver el detalle
              </div>
            )}
          </div>

          {/* ── SALDOS SNAPSHOT (latest) ────────────────── */}
          {!!saldos && (
            <div style={{ marginTop: "28px", background: C.surface, border: `1px solid ${C.border}`, padding: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "14px" }}>Saldos actuales (último corte)</div>
              <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px" }}>
                {[
                  { label: "Banorte", val: saldos.banorte },
                  { label: "AMEX", val: saldos.amex },
                  { label: "Efectivo", val: saldos.efectivo },
                  { label: "Utilidades", val: saldos.utilidades },
                  { label: "Aguinaldos", val: saldos.aguinaldos },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ fontSize: "11px", color: C.faint, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
                    <div style={{ fontSize: "20px", fontWeight: 700, marginTop: "4px", fontVariantNumeric: "tabular-nums" }}>{money(s.val)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* footer */}
          <div style={{ marginTop: "32px", paddingTop: "16px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: C.faint }}>
            <span>Vista de solo lectura · SantoOS</span>
            <span>Datos actualizados automáticamente</span>
          </div>
        </div>
      </div>
    </>
  );
}
