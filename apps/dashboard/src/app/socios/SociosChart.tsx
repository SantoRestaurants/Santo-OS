"use client";

import { useMemo, useState } from "react";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ComposedChart } from "recharts";

type DataPoint = {
  fecha: string;
  label: string;
  venta: number;
  meta: number;
  hasVenta: boolean;
};

type ChartProps = {
  monthData: DataPoint[];
  weekData: DataPoint[];
};

function money(v: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(v);
}

export function SociosChart({ monthData, weekData }: ChartProps) {
  const [timeframe, setTimeframe] = useState<"month" | "week">("month");
  const [viewType, setViewType] = useState<"daily" | "cumulative">("daily");

  const data = useMemo(() => {
    const baseData = timeframe === "month" ? monthData : weekData;
    if (viewType === "daily") {
      return baseData;
    }
    // Cumulative
    let accVenta = 0;
    let accMeta = 0;
    return baseData.map(d => {
      accMeta += d.meta || 0;
      if (d.hasVenta) {
        accVenta += d.venta || 0;
      }
      return {
        ...d,
        accVenta: d.hasVenta ? accVenta : null,
        accMeta: accMeta,
      };
    });
  }, [timeframe, viewType, monthData, weekData]);

  const maxValue = useMemo(() => {
    if (viewType === "daily") {
      return Math.max(...data.map(d => Math.max(d.venta || 0, d.meta || 0))) * 1.1;
    } else {
      return Math.max(...data.map(d => Math.max((d as any).accVenta || 0, (d as any).accMeta || 0))) * 1.1;
    }
  }, [data, viewType]);

  const CustomTooltipDaily = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const vta = payload.find((p: any) => p.dataKey === "venta")?.value || 0;
      const meta = payload.find((p: any) => p.dataKey === "meta")?.value || 0;
      const hasVenta = payload[0]?.payload?.hasVenta;
      const diff = vta - meta;

      return (
        <div style={{ background: "#1c1a1e", border: "1px solid rgba(255,255,255,0.07)", padding: "12px", fontSize: "12px", fontFamily: "var(--font-geist-mono)" }}>
          <div style={{ color: "#e8e4df", marginBottom: "8px", fontWeight: "bold" }}>{label}</div>
          <div style={{ color: "#e8463b", marginBottom: "4px" }}>Venta: {hasVenta ? money(vta) : "—"}</div>
          <div style={{ color: "#8a837a", marginBottom: "4px" }}>Meta: {money(meta)}</div>
          {hasVenta && meta > 0 && (
            <div style={{ color: diff >= 0 ? "#4ade80" : "#f87171", marginTop: "8px" }}>
              Diferencia: {diff >= 0 ? "+" : ""}{money(diff)}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const CustomTooltipCumulative = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const accVta = payload.find((p: any) => p.dataKey === "accVenta")?.value;
      const accMeta = payload.find((p: any) => p.dataKey === "accMeta")?.value || 0;
      const hasVenta = payload[0]?.payload?.hasVenta;
      const diff = accVta != null ? accVta - accMeta : 0;

      return (
        <div style={{ background: "#1c1a1e", border: "1px solid rgba(255,255,255,0.07)", padding: "12px", fontSize: "12px", fontFamily: "var(--font-geist-mono)" }}>
          <div style={{ color: "#e8e4df", marginBottom: "8px", fontWeight: "bold" }}>Acumulado al {label}</div>
          <div style={{ color: "#e8463b", marginBottom: "4px" }}>Venta: {hasVenta && accVta != null ? money(accVta) : "—"}</div>
          <div style={{ color: "#8a837a", marginBottom: "4px" }}>Meta: {money(accMeta)}</div>
          {hasVenta && accVta != null && accMeta > 0 && (
            <div style={{ color: diff >= 0 ? "#4ade80" : "#f87171", marginTop: "8px" }}>
              Diferencia: {diff >= 0 ? "+" : ""}{money(diff)}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "#8a837a", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Gráficos de Comparativa
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ display: "flex", background: "#141414", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "4px", overflow: "hidden" }}>
            <button 
              onClick={() => setTimeframe("month")}
              style={{ background: timeframe === "month" ? "#e8463b" : "transparent", color: timeframe === "month" ? "#fff" : "#8a837a", border: "none", padding: "6px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", cursor: "pointer", fontFamily: "var(--font-geist-sans)" }}
            >Mes Completo</button>
            <button 
              onClick={() => setTimeframe("week")}
              style={{ background: timeframe === "week" ? "#e8463b" : "transparent", color: timeframe === "week" ? "#fff" : "#8a837a", border: "none", padding: "6px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", cursor: "pointer", fontFamily: "var(--font-geist-sans)" }}
            >Esta Semana</button>
          </div>
          <div style={{ display: "flex", background: "#141414", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "4px", overflow: "hidden" }}>
            <button 
              onClick={() => setViewType("daily")}
              style={{ background: viewType === "daily" ? "#282521" : "transparent", color: viewType === "daily" ? "#fff" : "#8a837a", border: "none", padding: "6px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", cursor: "pointer", fontFamily: "var(--font-geist-sans)" }}
            >Diario</button>
            <button 
              onClick={() => setViewType("cumulative")}
              style={{ background: viewType === "cumulative" ? "#282521" : "transparent", color: viewType === "cumulative" ? "#fff" : "#8a837a", border: "none", padding: "6px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", cursor: "pointer", fontFamily: "var(--font-geist-sans)" }}
            >Acumulado</button>
          </div>
        </div>
      </div>

      <div style={{ width: "100%", height: "260px", fontFamily: "var(--font-geist-mono)" }}>
        <ResponsiveContainer width="100%" height="100%">
          {viewType === "daily" ? (
            <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="label" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: "#8a837a", fontSize: 10 }}
                dy={10}
              />
              <YAxis hide domain={[0, maxValue]} />
              <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} content={<CustomTooltipDaily />} />
              <Bar dataKey="meta" fill="#242226" radius={[2, 2, 0, 0]} />
              <Bar dataKey="venta" radius={[2, 2, 0, 0]}>
                {data.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.venta >= entry.meta ? "#e8463b" : "#b84a3a"} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="label" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: "#8a837a", fontSize: 10 }}
                dy={10}
              />
              <YAxis hide domain={[0, maxValue]} />
              <Tooltip content={<CustomTooltipCumulative />} />
              <Area type="monotone" dataKey="accMeta" stroke="#4a4640" fill="rgba(74, 70, 64, 0.1)" strokeWidth={2} />
              <Line type="monotone" dataKey="accVenta" stroke="#e8463b" strokeWidth={3} dot={false} activeDot={{ r: 6, fill: "#e8463b", stroke: "#000", strokeWidth: 2 }} />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
