"use client";

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

type ChartProps = {
  data: {
    fecha: string;
    label: string;
    venta: number;
    meta: number;
    hasVenta: boolean;
  }[];
};

function money(v: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(v);
}

export function SociosChart({ data }: ChartProps) {
  const maxValue = useMemo(() => {
    return Math.max(...data.map(d => Math.max(d.venta || 0, d.meta || 0))) * 1.1;
  }, [data]);

  const CustomTooltip = ({ active, payload, label }: any) => {
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

  return (
    <div style={{ width: "100%", height: "240px", fontFamily: "var(--font-geist-mono)" }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
          <XAxis 
            dataKey="label" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fill: "#8a837a", fontSize: 10 }}
            dy={10}
          />
          <YAxis 
            hide
            domain={[0, maxValue]} 
          />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.02)" }} content={<CustomTooltip />} />
          <Bar dataKey="meta" fill="#242226" radius={[2, 2, 0, 0]} />
          <Bar dataKey="venta" radius={[2, 2, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.venta >= entry.meta ? "#e8463b" : "#b84a3a"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
