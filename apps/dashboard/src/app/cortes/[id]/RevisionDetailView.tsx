import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import type { CorteDetail, RevisionDocument } from "@/lib/corte-data";

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
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parsed);
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

function diffColor(value: number): string {
  if (value > 0) return "#4CAF82";
  if (value < 0) return "#E05A5A";
  return "#666666";
}

function KpiCard({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div style={{ background: "#111", padding: "20px 16px", textAlign: "center" }}>
      <span style={{ fontSize: 20, fontWeight: 600, color: color ?? GOLD, display: "block" }}>{value}</span>
      <span style={{ fontSize: 10, letterSpacing: "1.5px", textTransform: "uppercase", color: "#666", marginTop: 4, display: "block" }}>{label}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: GOLD, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
      {children}
      <span style={{ flex: 1, height: 1, background: "#222" }} />
    </div>
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

export function RevisionDetailView({ revision, corte }: { revision: RevisionDocument; corte: CorteDetail }) {
  return (
    <div style={{ background: "#080808", color: CREAM, minHeight: "100vh", fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: "32px 40px 24px", borderBottom: "1px solid #222", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <Link href="/cortes" style={{ fontSize: 11, letterSpacing: 1, color: "#666", textDecoration: "none", display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
            <ArrowLeft style={{ width: 12, height: 12 }} /> VOLVER
          </Link>
          <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: 6, textTransform: "uppercase", color: GOLD }}>REVISION</h1>
          <p style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#666", marginTop: 4 }}>{revision.unidad ?? "SANTO"}</p>
        </div>
        <div style={{ textAlign: "right", fontSize: 11, color: "#666", letterSpacing: 1 }}>
          <span style={{ fontSize: 13, color: CREAM }}>{formatDate(corte.business_date)}</span>
          <div style={{ marginTop: 4 }}>
            <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 4, fontSize: 10, fontWeight: 600, letterSpacing: 0.5, background: statusColor(corte.status) + "22", color: statusColor(corte.status), border: `1px solid ${statusColor(corte.status)}44` }}>
              {statusLabel(corte.status)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ padding: "32px 40px", maxWidth: 1400 }}>
        {/* KPI Strip: VTA AL DIA */}
        {revision.vta_al_dia && (
          <>
            <SectionTitle>VTA AL DÍA</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "#222", border: "1px solid #222", borderRadius: 8, overflow: "hidden", marginBottom: 40 }}>
              <KpiCard value={formatCurrency(revision.vta_al_dia.meta_vta)} label="META DE VTA" />
              <KpiCard value={formatCurrency(revision.vta_al_dia.venta_real)} label="VENTA REAL" />
              <KpiCard value={formatCurrency(revision.vta_al_dia.diferencia)} label="DIFERENCIA" color={diffColor(revision.vta_al_dia.diferencia)} />
              <KpiCard value={revision.vta_al_dia.pct_diferencia != null ? `${revision.vta_al_dia.pct_diferencia}%` : "-"} label="% DIFERENCIA" color={diffColor(revision.vta_al_dia.pct_diferencia ?? 0)} />
            </div>
          </>
        )}

        {/* VTA META DEL MES */}
        {revision.vta_meta_mes && (
          <>
            <SectionTitle>VTA META DEL MES</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "#222", border: "1px solid #222", borderRadius: 8, overflow: "hidden", marginBottom: 40 }}>
              <KpiCard value={formatCurrency(revision.vta_meta_mes.meta_vta)} label="META MES" />
              <KpiCard value={formatCurrency(revision.vta_meta_mes.venta_real)} label="VENTA REAL" />
              <KpiCard value={formatCurrency(revision.vta_meta_mes.diferencia)} label="DIFERENCIA" color={diffColor(revision.vta_meta_mes.diferencia)} />
            </div>
          </>
        )}

        {/* Format + Reconciliation side by side */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 40 }}>
          <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#666", marginBottom: 16 }}>FORMATO DE CORTE</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: revision.formato_corte === "BIEN" ? "#4CAF82" : "#E05A5A" }}>
              {revision.formato_corte ?? "-"}
            </div>
          </div>
          {revision.reconciliation_totals && (
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#666", marginBottom: 16 }}>CONCILIACION</div>
              <div style={{ display: "flex", gap: 24 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>TOTAL REAL</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: GOLD }}>{formatCurrency(revision.reconciliation_totals.total_real)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>TOTAL SISTEMA</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: CREAM }}>{formatCurrency(revision.reconciliation_totals.total_sistema)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#666", letterSpacing: 1 }}>DIFERENCIA</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: diffColor(revision.reconciliation_totals.difference) }}>{formatCurrency(revision.reconciliation_totals.difference)}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* VTA POR DIA table */}
        {revision.vta_por_dia && revision.vta_por_dia.length > 0 && (
          <>
            <SectionTitle>VTA POR DIA</SectionTitle>
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, overflow: "hidden", marginBottom: 40 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#666", padding: "8px 10px", borderBottom: "1px solid #222" }}>DIA</th>
                    <th style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#666", padding: "8px 10px", borderBottom: "1px solid #222" }}>FECHA</th>
                    <th style={{ textAlign: "right", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#666", padding: "8px 10px", borderBottom: "1px solid #222" }}>META DE VTA</th>
                    <th style={{ textAlign: "right", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#666", padding: "8px 10px", borderBottom: "1px solid #222" }}>VENTA REAL</th>
                    <th style={{ textAlign: "right", fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", color: "#666", padding: "8px 10px", borderBottom: "1px solid #222" }}>DIFERENCIA</th>
                  </tr>
                </thead>
                <tbody>
                  {revision.vta_por_dia.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #1a1a1a" }}>
                      <td style={{ padding: "10px", color: CREAM }}>{row.dia}</td>
                      <td style={{ padding: "10px", color: CREAM }}>{formatDateShort(row.fecha)}</td>
                      <td style={{ padding: "10px", textAlign: "right", color: "#666" }}>{formatCurrency(row.meta_vta)}</td>
                      <td style={{ padding: "10px", textAlign: "right", color: row.venta_real > 0 ? GOLD : "#333", fontWeight: 600 }}>{formatCurrency(row.venta_real)}</td>
                      <td style={{ padding: "10px", textAlign: "right", color: diffColor(row.diferencia), fontWeight: 600 }}>{formatCurrency(row.diferencia)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* SALDOS + FALTA POR ENTRAR */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 40 }}>
          {revision.saldos && (
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#666", marginBottom: 16 }}>SALDOS</div>
              <SaldoRow label="PROV. AGUINALDOS" value={revision.saldos.prov_aguinaldos} />
              <SaldoRow label="SALDO BANORTE" value={revision.saldos.saldo_banorte} />
              <SaldoRow label="PROV. UTILIDADES" value={revision.saldos.prov_utilidades} />
              <div style={{ borderTop: "1px solid #222", marginTop: 8, paddingTop: 8 }}>
                <SaldoRow label="TOTAL" value={revision.saldos.total} bold />
              </div>
            </div>
          )}

          {revision.falta_por_entrar && Object.keys(revision.falta_por_entrar).length > 0 && (
            <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#666", marginBottom: 16 }}>FALTA POR ENTRAR</div>
              {Object.entries(revision.falta_por_entrar).map(([key, value]) => (
                <SaldoRow key={key} label={key.toUpperCase().replace(/_/g, " ")} value={value} />
              ))}
            </div>
          )}
        </div>

        {/* GASTOS + AJUSTES */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 40 }}>
          <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#666", marginBottom: 16 }}>GASTOS ADICIONALES</div>
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

          <div style={{ background: "#111", border: "1px solid #222", borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: "#666", marginBottom: 16 }}>AJUSTES DEL DIA</div>
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
