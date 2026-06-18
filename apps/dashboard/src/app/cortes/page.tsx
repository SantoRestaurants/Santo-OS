import { ArrowLeft, Calendar, Play, RefreshCw } from "lucide-react";
import Link from "next/link";

import { getCorteList, extractRevisionDocument, type CorteDetail, type RevisionDocument } from "@/lib/corte-data";

const GOLD = "#C9A84C";
const CREAM = "#E8E0D0";

function formatCurrency(value: number | undefined | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
}

function formatDate(date: string | null): string {
  if (!date) return "-";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

function formatDateShort(date: string | null): string {
  if (!date) return "-";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short" }).format(parsed);
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    completed: "Completado",
    requires_review: "Revisión",
    ready_for_approval: "Listo",
    waiting_for_input: "Faltan datos",
    bank_validated: "Validado",
  };
  return map[status] ?? status;
}

function statusColor(status: string): string {
  if (status === "completed" || status === "bank_validated") return "#4CAF82";
  if (status === "requires_review") return "#E08A3A";
  if (status === "ready_for_approval") return "#5A8AE0";
  if (status === "waiting_for_input") return "#E05A5A";
  return "#666666";
}

function differenceColor(value: number): string {
  if (value > 0) return "#4CAF82";
  if (value < 0) return "#E05A5A";
  return "#666666";
}

// --- REVISION Detail View ---
function RevisionView({ revision, corte }: { revision: RevisionDocument; corte: CorteDetail }) {
  return (
    <div style={{ background: "#080808", color: CREAM, minHeight: "100vh", fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: "32px 40px 24px", borderBottom: "1px solid #222", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <Link href="/cortes" style={{ fontSize: "11px", letterSpacing: "1px", color: "#666", textDecoration: "none", display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
            <ArrowLeft style={{ width: 12, height: 12 }} /> VOLVER
          </Link>
          <h1 style={{ fontSize: "28px", fontWeight: 300, letterSpacing: "6px", textTransform: "uppercase", color: GOLD }}>
            REVISION
          </h1>
          <p style={{ fontSize: "11px", letterSpacing: "3px", textTransform: "uppercase", color: "#666", marginTop: "4px" }}>
            {revision.unidad ?? "SANTO"}
          </p>
        </div>
        <div style={{ textAlign: "right", fontSize: "11px", color: "#666", letterSpacing: "1px" }}>
          <span style={{ fontSize: "13px", color: CREAM }}>{formatDate(corte.business_date)}</span>
          <div style={{ marginTop: "4px" }}>
            <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: "4px", fontSize: "10px", fontWeight: 600, letterSpacing: "0.5px", background: statusColor(corte.status) + "22", color: statusColor(corte.status), border: `1px solid ${statusColor(corte.status)}44` }}>
              {statusLabel(corte.status)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: "32px 40px", maxWidth: 1400 }}>
        {/* KPI Strip */}
        {revision.vta_al_dia && (
          <>
            <div style={{ fontSize: "10px", letterSpacing: "3px", textTransform: "uppercase", color: GOLD, marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
              VTA AL DÍA
              <span style={{ flex: 1, height: 1, background: "#222" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "#222", border: "1px solid #222", borderRadius: 8, overflow: "hidden", marginBottom: 40 }}>
              <KpiCard value={formatCurrency(revision.vta_al_dia.meta_vta)} label="META DE VTA" />
              <KpiCard value={formatCurrency(revision.vta_al_dia.venta_real)} label="VENTA REAL" />
              <KpiCard value={formatCurrency(revision.vta_al_dia.diferencia)} label="DIFERENCIA" color={differenceColor(revision.vta_al_dia.diferencia)} />
              <KpiCard value={revision.vta_al_dia.pct_diferencia != null ? `${revision.vta_al_dia.pct_diferencia}%` : "-"} label="% DIFERENCIA" color={differenceColor(revision.vta_al_dia.pct_diferencia ?? 0)} />
            </div>
          </>
        )}

        {/* VTA META DEL MES */}
        {revision.vta_meta_mes && (
          <>
            <div style={{ fontSize: "10px", letterSpacing: "3px", textTransform: "uppercase", color: GOLD, marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
              VTA META DEL MES
              <span style={{ flex: 1, height: 1, background: "#222" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "#222", border: "1px solid #222", borderRadius: 8, overflow: "hidden", marginBottom: 40 }}>
              <KpiCard value={formatCurrency(revision.vta_meta_mes.meta_vta)} label="META MES" />
              <KpiCard value={formatCurrency(revision.vta_meta_mes.venta_real)} label="VENTA REAL" />
              <KpiCard value={formatCurrency(revision.vta_meta_mes.diferencia)} label="DIFERENCIA" color={differenceColor(revision.vta_meta_mes.diferencia)} />
            </div>
          </>
        )}

        {/* Format + Reconciliation */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 40 }}>
          <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#666", marginBottom: 16 }}>FORMATO DE CORTE</div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: revision.formato_corte === "BIEN" ? "#4CAF82" : "#E05A5A" }}>
              {revision.formato_corte ?? "-"}
            </div>
          </div>
          {revision.reconciliation_totals && (
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#666", marginBottom: 16 }}>CONCILIACIÓN</div>
              <div style={{ display: "flex", gap: 24 }}>
                <div>
                  <div style={{ fontSize: "10px", color: "#666", letterSpacing: "1px" }}>TOTAL REAL</div>
                  <div style={{ fontSize: "18px", fontWeight: 600, color: GOLD }}>{formatCurrency(revision.reconciliation_totals.total_real)}</div>
                </div>
                <div>
                  <div style={{ fontSize: "10px", color: "#666", letterSpacing: "1px" }}>TOTAL SISTEMA</div>
                  <div style={{ fontSize: "18px", fontWeight: 600, color: CREAM }}>{formatCurrency(revision.reconciliation_totals.total_sistema)}</div>
                </div>
                <div>
                  <div style={{ fontSize: "10px", color: "#666", letterSpacing: "1px" }}>DIFERENCIA</div>
                  <div style={{ fontSize: "18px", fontWeight: 600, color: differenceColor(revision.reconciliation_totals.difference) }}>{formatCurrency(revision.reconciliation_totals.difference)}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* VTA POR DIA */}
        {revision.vta_por_dia && revision.vta_por_dia.length > 0 && (
          <>
            <div style={{ fontSize: "10px", letterSpacing: "3px", textTransform: "uppercase", color: GOLD, marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
              VTA POR DIA
              <span style={{ flex: 1, height: 1, background: "#222" }} />
            </div>
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, overflow: "hidden", marginBottom: 40 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <Th>DÍA</Th>
                    <Th>FECHA</Th>
                    <Th align="right">META DE VTA</Th>
                    <Th align="right">VENTA REAL</Th>
                    <Th align="right">DIFERENCIA</Th>
                  </tr>
                </thead>
                <tbody>
                  {revision.vta_por_dia.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1a1a1a" }}>
                      <Td>{row.dia}</Td>
                      <Td>{formatDateShort(row.fecha)}</Td>
                      <Td align="right" color="#666">{formatCurrency(row.meta_vta)}</Td>
                      <Td align="right" color={row.venta_real > 0 ? GOLD : "#333"}>{formatCurrency(row.venta_real)}</Td>
                      <Td align="right" color={differenceColor(row.diferencia)}>{formatCurrency(row.diferencia)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 40 }}>
          {/* SALDOS */}
          {revision.saldos && (
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#666", marginBottom: 16 }}>SALDOS</div>
              <SaldoRow label="PROV. AGUINALDOS" value={revision.saldos.prov_aguinaldos} />
              <SaldoRow label="SALDO BANORTE" value={revision.saldos.saldo_banorte} />
              <SaldoRow label="PROV. UTILIDADES" value={revision.saldos.prov_utilidades} />
              <div style={{ borderTop: "1px solid #222", marginTop: 8, paddingTop: 8 }}>
                <SaldoRow label="TOTAL" value={revision.saldos.total} bold />
              </div>
            </div>
          )}

          {/* FALTA POR ENTRAR */}
          {revision.falta_por_entrar && Object.keys(revision.falta_por_entrar).length > 0 && (
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#666", marginBottom: 16 }}>FALTA POR ENTRAR</div>
              {Object.entries(revision.falta_por_entrar).map(([key, value]) => (
                <SaldoRow key={key} label={key.toUpperCase().replace(/_/g, " ")} value={value} />
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 40 }}>
          {/* GASTOS ADICIONALES */}
          <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#666", marginBottom: 16 }}>GASTOS ADICIONALES</div>
            {(!revision.gastos_adicionales || revision.gastos_adicionales.length === 0) ? (
              <div style={{ fontSize: 12, color: "#333", fontStyle: "italic" }}>Sin gastos adicionales</div>
            ) : (
              revision.gastos_adicionales.map((g, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
                  <span style={{ color: CREAM }}>{g.concepto}</span>
                  <span style={{ color: GOLD, fontWeight: 600 }}>{formatCurrency(g.importe)}</span>
                </div>
              ))
            )}
          </div>

          {/* AJUSTES DEL DIA */}
          <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#666", marginBottom: 16 }}>AJUSTES DEL DÍA</div>
            {(!revision.ajustes_del_dia || revision.ajustes_del_dia.length === 0) ? (
              <div style={{ fontSize: 12, color: "#333", fontStyle: "italic" }}>Sin ajustes</div>
            ) : (
              revision.ajustes_del_dia.map((a, i) => (
                <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: CREAM }}>{a.concepto}</span>
                    <span style={{ color: GOLD, fontWeight: 600 }}>{formatCurrency(a.importe)}</span>
                  </div>
                  {a.observaciones && <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{a.observaciones}</div>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div style={{ background: "#111", padding: "20px 16px", textAlign: "center" }}>
      <span style={{ fontSize: 20, fontWeight: 600, color: color ?? GOLD, display: "block" }}>{value}</span>
      <span style={{ fontSize: 10, letterSpacing: "1.5px", textTransform: "uppercase", color: "#666", marginTop: 4, display: "block" }}>{label}</span>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th style={{ textAlign: align ?? "left", fontSize: 9, letterSpacing: "1.5px", textTransform: "uppercase", color: "#666", padding: "8px 10px", borderBottom: "1px solid #222" }}>
      {children}
    </th>
  );
}

function Td({ children, align, color }: { children: React.ReactNode; align?: "left" | "right"; color?: string }) {
  return (
    <td style={{ padding: "10px 10px", borderBottom: "1px solid #1a1a1a", verticalAlign: "middle", textAlign: align ?? "left", color: color ?? CREAM }}>
      {children}
    </td>
  );
}

function SaldoRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #1a1a1a", fontSize: 12 }}>
      <span style={{ color: "#666", fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ color: value >= 0 ? GOLD : "#E05A5A", fontWeight: bold ? 700 : 600 }}>{formatCurrency(value)}</span>
    </div>
  );
}

// --- Corte List Card ---
function CorteCard({ corte }: { corte: CorteDetail }) {
  const revision = extractRevisionDocument(corte);
  const ventaReal = revision?.vta_al_dia?.venta_real;
  const diferencia = revision?.vta_al_dia?.diferencia;
  const formato = revision?.formato_corte;

  return (
    <Link href={`/cortes/${corte.id}`} className="corte-card" style={{ textDecoration: "none" }}>
      <div className="corte-card-inner" style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", transition: "border-color 0.2s", cursor: "pointer" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: CREAM }}>{formatDate(corte.business_date)}</div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
            {corte.source_channel === "agent_mail" ? "Email" : corte.source_channel}
            {formato && <span style={{ marginLeft: 12, color: formato === "BIEN" ? "#4CAF82" : "#E05A5A" }}>{formato}</span>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          {ventaReal != null && (
            <div style={{ fontSize: 18, fontWeight: 600, color: GOLD }}>{formatCurrency(ventaReal)}</div>
          )}
          {diferencia != null && (
            <div style={{ fontSize: 11, color: differenceColor(diferencia), marginTop: 2 }}>
              {diferencia >= 0 ? "+" : ""}{formatCurrency(diferencia)}
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: statusColor(corte.status) + "22", color: statusColor(corte.status), border: `1px solid ${statusColor(corte.status)}44` }}>
              {statusLabel(corte.status)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// --- Workflow Trigger Buttons ---
function WorkflowTriggers() {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <TriggerButton label="Agent Mail" icon={<Play style={{ width: 12, height: 12 }} />} />
      <TriggerButton label="Bank Watcher" icon={<RefreshCw style={{ width: 12, height: 12 }} />} />
    </div>
  );
}

function TriggerButton({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <button
      className="trigger-btn"
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 6, background: "#111", border: "1px solid #222", color: CREAM, fontSize: 11, letterSpacing: "1px", textTransform: "uppercase", cursor: "pointer", transition: "border-color 0.2s" }}
    >
      {icon} {label}
    </button>
  );
}

// --- Main Page ---
export default async function CortesPage() {
  const { status, cortes, error } = await getCorteList();

  if (status === "auth_required") {
    return (
      <div style={{ background: "#080808", color: CREAM, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 14, color: CREAM }}>Inicia sesión para ver los cortes</p>
          <Link href="/auth/sign-in" style={{ display: "inline-block", marginTop: 16, padding: "10px 24px", borderRadius: 8, background: GOLD, color: "#080808", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>Iniciar sesión</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#080808", color: CREAM, minHeight: "100vh", fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
      <style>{`
        .corte-card-inner:hover, .corte-card:hover .corte-card-inner { border-color: ${GOLD} !important; }
        .trigger-btn:hover { border-color: ${GOLD} !important; }
      `}</style>
      {/* Header */}
      <div style={{ padding: "32px 40px 24px", borderBottom: "1px solid #222", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: 6, textTransform: "uppercase", color: GOLD }}>CORTES</h1>
          <p style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#666", marginTop: 4 }}>SANTO — Historial de cortes diarios</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <WorkflowTriggers />
          <div style={{ textAlign: "right", fontSize: 11, color: "#666", letterSpacing: 1 }}>
            <span style={{ fontSize: 13, color: CREAM }}>{cortes.length} cortes</span>
          </div>
        </div>
      </div>

      <div style={{ padding: "32px 40px", maxWidth: 1400 }}>
        {/* Filter bar */}
        <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 6, background: "#111", border: "1px solid #222", fontSize: 11, color: "#666" }}>
            <Calendar style={{ width: 12, height: 12 }} />
            <span>Todos los días</span>
          </div>
        </div>

        {/* Section title */}
        <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: GOLD, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
          HISTORIAL
          <span style={{ flex: 1, height: 1, background: "#222" }} />
        </div>

        {/* Error state */}
        {error && (
          <div style={{ background: "#1a0a0a", border: "1px solid #4a2a2a", borderRadius: 8, padding: 20, fontSize: 12, color: "#E05A5A" }}>
            Error: {error}
          </div>
        )}

        {/* Empty state */}
        {cortes.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>&#9744;</div>
            <p style={{ fontSize: 14, color: "#666" }}>Todavía no hay cortes</p>
            <p style={{ fontSize: 12, color: "#444", marginTop: 8 }}>Los cortes aparecerán aquí cuando se procesen</p>
          </div>
        )}

        {/* Corte list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cortes.map((corte) => (
            <CorteCard key={corte.id} corte={corte} />
          ))}
        </div>
      </div>
    </div>
  );
}
