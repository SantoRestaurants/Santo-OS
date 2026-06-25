import { getReconciliationData } from "@/lib/reconciliation-data";
import { getMonthlyTotals, dedupeRunsByDay } from "@/lib/corte-dashboard-utils";
import Link from "next/link";

export const dynamic = 'force-dynamic';

function money(value: number | undefined | null) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 10_000) return Math.round(n / 1000) + "K";
  if (Math.abs(n) >= 1_000) return (n / 1000).toFixed(1) + "K";
  return String(Math.round(n));
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default async function SociosPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const params = await searchParams;
  const data = await getReconciliationData();
  
  if (data.status === "requires_config") {
    return (
      <main className="min-h-screen bg-black text-red-500 font-mono flex items-center justify-center">
        <div>SYS.ERR: DATABASE_OFFLINE</div>
      </main>
    );
  }

  const allRuns = data.runs.filter((run) => run.business_date);
  const runs = dedupeRunsByDay(allRuns);
  
  const monthsSet = new Set(runs.map(r => r.business_date?.slice(0, 7)).filter(Boolean));
  const months = Array.from(monthsSet).sort().reverse();
  const todayMonth = new Date().toISOString().slice(0, 7);
  if (!months.includes(todayMonth)) months.unshift(todayMonth);
  
  const selectedMonth = params.month && months.includes(params.month) ? params.month : months[0];
  
  const monthRuns = runs.filter(r => r.business_date?.startsWith(selectedMonth || ""));
  const { monthTotal, monthMeta } = getMonthlyTotals(monthRuns, selectedMonth || "");
  const monthDiff = monthMeta ? monthTotal - monthMeta : null;
  const monthProgress = monthMeta ? Math.min((monthTotal / monthMeta) * 100, 100) : 0;
  
  const latestRun = runs[0];
  const saldos = latestRun?.output_payload?.saldos as Record<string, number> | undefined;

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        :root {
          --accent-h: 20;
          --bg: oklch(0.12 0.005 270);
          --ink: oklch(0.9 0.004 270);
          --ink-dim: oklch(0.62 0.005 270);
          --ink-faint: oklch(0.43 0.004 270);
          --ember: hsl(var(--accent-h) 50% 62%);
          --ember-hot: hsl(var(--accent-h) 65% 72%);
          --white-hot: hsl(var(--accent-h) 40% 90%);
          --cobalt: oklch(0.62 0.17 265);
          --ok: oklch(0.7 0.15 150);
          --warn: oklch(0.78 0.13 80);
          --err: oklch(0.62 0.22 30);
          --line: hsl(var(--accent-h) 50% 60% / 0.25);
          --line-faint: hsl(var(--accent-h) 50% 60% / 0.12);
        }
        body {
          background: var(--bg) !important;
          color: var(--ink) !important;
          font-family: var(--font-geist-mono), monospace !important;
          margin: 0;
          padding: 0;
        }
        .hud {
          display: grid;
          grid-template-columns: 320px 1fr 320px;
          gap: 24px;
          padding: 28px 36px;
          min-height: 100vh;
        }
        @media (max-width: 1024px) {
          .hud {
            grid-template-columns: 1fr;
            padding: 16px;
          }
        }
        .grain {
          position: fixed;
          inset: 0;
          pointer-events: none;
          opacity: 0.045;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
          z-index: 100;
        }
        .sec-title {
          display: flex;
          align-items: baseline;
          gap: 10px;
          font-size: 9px;
          font-weight: 500;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--ember);
          margin-bottom: 14px;
        }
        .sec-title::after {
          content: "";
          flex: 1;
          height: 1px;
          align-self: center;
          background: linear-gradient(90deg, var(--line), transparent);
        }
        .vital {
          display: grid;
          grid-template-columns: 1fr auto;
          column-gap: 16px;
          grid-template-areas: "label delta" "value value" "spark spark";
          align-items: baseline;
          padding: 10px 0 12px;
          border-bottom: 1px solid var(--line-faint);
        }
        .vital:last-child { border-bottom: none; }
        .vital .label {
          grid-area: label;
          font-size: 8.5px;
          letter-spacing: 0.2em;
          color: var(--ink-dim);
          text-transform: uppercase;
        }
        .vital .value {
          grid-area: value;
          font-size: 32px;
          font-weight: 300;
          letter-spacing: 0.02em;
          color: var(--ink);
          margin-top: 4px;
        }
        .vital .delta {
          grid-area: delta;
          font-size: 9px;
          color: var(--ember-hot);
          letter-spacing: 0.1em;
        }
        .vital .delta.neg { color: var(--err); }
        .status-dot {
          display: inline-block;
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--ember);
          box-shadow: 0 0 8px var(--ember);
          margin-right: 6px;
        }
        .status-dot.ok { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
        .status-dot.err { background: var(--err); box-shadow: 0 0 8px var(--err); }
        .wordmark {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 32px;
        }
        .wordmark .name {
          font-size: 34px;
          font-weight: 600;
          letter-spacing: 0.34em;
          line-height: 1;
          color: var(--white-hot);
        }
        .wordmark .expansion {
          font-size: 8px;
          letter-spacing: 0.3em;
          color: var(--ink-faint);
          text-transform: uppercase;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          font-size: 8px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          border: 1px solid var(--line);
          color: var(--ink-dim);
          text-decoration: none;
        }
        .chip.active {
          color: var(--ember-hot);
          border-color: var(--ember);
          background: hsl(var(--accent-h) 50% 50% / 0.1);
        }
        .chip:hover {
          color: var(--white-hot);
          border-color: var(--white-hot);
        }
        .day-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid var(--line-faint);
          font-size: 11px;
        }
        .day-row:hover {
          background: hsl(var(--accent-h) 50% 50% / 0.05);
        }
        .day-date { color: var(--ink-dim); font-size: 10px; }
        .day-val { color: var(--ink); font-weight: 500; }
        .day-diff { color: var(--ember-hot); font-size: 9px; }
        .day-diff.neg { color: var(--err); }
        .progress-bar {
          height: 2px;
          background: var(--line-faint);
          margin-top: 8px;
          width: 100%;
          position: relative;
        }
        .progress-fill {
          position: absolute;
          left: 0; top: 0; bottom: 0;
          background: var(--ember);
          box-shadow: 0 0 8px var(--ember);
        }
        .objective {
          margin-top: 24px;
        }
      `}} />

      <div className="grain" />
      
      <div className="hud">
        {/* LEFT COLUMN: IDENT & MONTHS */}
        <div className="flex flex-col gap-6">
          <div className="wordmark">
            <span className="name">S.A.N.T.O.</span>
            <span className="expansion">System Analytics & Node Terminal Output</span>
          </div>

          <div>
            <div className="sec-title"><span>TIMEBOX</span><span className="tick">CYCLE</span></div>
            <div className="flex flex-wrap gap-2">
              {months.slice(0, 4).map(month => {
                const date = new Date(`${month}-01T00:00:00`);
                const label = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(date).toUpperCase();
                return (
                  <Link 
                    key={month} 
                    href={`/socios?month=${month}`}
                    className={`chip ${month === selectedMonth ? 'active' : ''}`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="mt-8">
            <div className="sec-title"><span>DIRECTIVES</span><span className="tick">SYSTEM</span></div>
            <div className="text-[10px] text-[var(--ink-dim)] space-y-2 uppercase tracking-widest leading-relaxed">
              <div><i className="status-dot ok"></i> NETWORK LINK ACTIVE</div>
              <div><i className="status-dot ok"></i> DB SYNC OPTIMAL</div>
              <div><i className="status-dot err"></i> GRAPH CORE OFFLINE</div>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: MAIN VITALS */}
        <div className="flex flex-col gap-8">
          <div>
            <div className="sec-title"><span>REVENUE STREAM</span><span className="tick">PRIMARY</span></div>
            <div className="vital">
              <span className="label">GROSS ACCUMULATION</span>
              <span className="value">{money(monthTotal)}</span>
              <span className={`delta ${monthDiff != null && monthDiff < 0 ? 'neg' : ''}`}>
                {monthDiff == null ? "—" : `${monthDiff >= 0 ? "+" : ""}${fmt(monthDiff)} VS META`}
              </span>
            </div>
            
            <div className="objective">
              <div className="text-[9px] uppercase tracking-widest text-[var(--ink-dim)] mb-2 flex justify-between">
                <span>Objective Tracker</span>
                <span>{monthProgress.toFixed(1)}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${monthProgress}%` }} />
              </div>
              <div className="flex justify-between text-[8px] text-[var(--ink-faint)] mt-2 tracking-wider">
                <span>0</span>
                <span>{money(monthMeta)} META</span>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="sec-title"><span>LEDGER DEPOSITS</span><span className="tick">LIQUIDITY</span></div>
            <div className="grid grid-cols-1 gap-4">
              <div className="vital" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <span className="label">BANORTE TERMINALS</span>
                <span className="value">{money(saldos?.banorte || 0)}</span>
              </div>
              <div className="vital" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <span className="label">AMEX NETWORK</span>
                <span className="value">{money(saldos?.amex || 0)}</span>
              </div>
              <div className="vital" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <span className="label">PHYSICAL CURRENCY</span>
                <span className="value">{money(saldos?.efectivo || 0)}</span>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="sec-title"><span>RESERVES</span><span className="tick">LOCKED</span></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="vital" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <span className="label">UTILIDADES</span>
                <span className="value">{money(saldos?.utilidades || 0)}</span>
              </div>
              <div className="vital" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <span className="label">AGUINALDOS</span>
                <span className="value">{money(saldos?.aguinaldos || 0)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: TRAIL */}
        <div className="flex flex-col">
          <div className="sec-title"><span>CYCLE LOG</span><span className="tick">DAILY</span></div>
          
          <div className="flex flex-col">
            {monthRuns.length === 0 ? (
              <div className="text-[10px] text-[var(--ink-faint)] uppercase tracking-wider py-4">NO RECORDS FOUND</div>
            ) : (
              monthRuns.map(run => {
                const meta = run.output_payload?.vta_al_dia ? (run.output_payload.vta_al_dia as Record<string, number>).meta_vta : null;
                const total = run.output_payload?.vta_al_dia ? (run.output_payload.vta_al_dia as Record<string, number>).venta_real : null;
                const diff = total != null && meta != null ? total - meta : null;
                const isPositive = diff != null && diff >= 0;
                const isValidated = run.status === "completed" || run.status === "bank_validated";
                
                return (
                  <div key={run.id} className="day-row">
                    <div className="flex items-center gap-3">
                      <i className={`status-dot ${isValidated ? 'ok' : 'err'}`}></i>
                      <div className="flex flex-col">
                        <span className="day-date tracking-widest">{run.business_date ? run.business_date.slice(5) : '--'}</span>
                        <span className="day-val">{money(total)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[8px] text-[var(--ink-dim)] tracking-wider uppercase">VS {fmt(meta || 0)}</span>
                      <span className={`day-diff ${isPositive ? '' : 'neg'}`}>
                        {diff == null ? "—" : `${isPositive ? "+" : ""}${((diff / (meta || 1)) * 100).toFixed(1)}%`}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
}
