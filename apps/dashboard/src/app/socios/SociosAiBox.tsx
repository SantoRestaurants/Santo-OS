"use client";

import { Bot } from "lucide-react";
import { useState, useEffect } from "react";

const C = {
  bg: "#000000",
  surface: "#0a0a0a",
  surfaceHover: "#141414",
  border: "rgba(255,255,255,0.06)",
  ink: "#ffffff",
  dim: "#a3a3a3",
  faint: "#525252",
  santo: "#e8463b",
};

type WeekContext = {
  totalVendido: number;
  totalMeta: number;
  diasConCorte: number;
  cortes: Array<{ fecha: string; venta: number; meta: number | null; status: string }>;
};

type MonthContext = {
  totalVendido: number;
  totalMeta: number;
  progressPct: number;
};

type Props = {
  runId: string;
  unit?: string;
  weekContext?: WeekContext;
  monthContext?: MonthContext;
};

export function SociosAiBox({ runId, unit, weekContext, monthContext, selectedMonth, businessDate }: Props & { selectedMonth?: string; businessDate?: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setQuestion("");
    setAnswer("");
    setError("");
  }, [runId]);

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setAnswer("");
    setError("");
    try {
      const response = await fetch("/api/cortes/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, question: trimmed, unit, weekContext, monthContext, selectedMonth, businessDate }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo consultar la IA.");
      setAnswer(payload.answer ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo consultar la IA.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: "24px", display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: "11px", fontWeight: 600, color: C.dim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
        <Bot size={14} />
        Consultar Asistente IA
      </div>

      <textarea
        rows={2}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Preguntale a la IA sobre las variaciones de este día o la semana..."
        style={{
          width: "100%",
          background: C.bg,
          border: `1px solid ${C.border}`,
          color: C.ink,
          padding: "12px",
          fontSize: "13px",
          fontFamily: "var(--font-geist-sans), sans-serif",
          resize: "vertical",
          outline: "none"
        }}
        onFocus={(e) => (e.target.style.borderColor = "rgba(255,255,255,0.2)")}
        onBlur={(e) => (e.target.style.borderColor = C.border)}
      />

      <div style={{ marginTop: "12px", display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={ask}
          disabled={loading || question.trim().length === 0}
          style={{
            background: loading || question.trim().length === 0 ? C.surfaceHover : C.santo,
            color: loading || question.trim().length === 0 ? C.dim : "#fff",
            border: loading || question.trim().length === 0 ? `1px solid ${C.border}` : "none",
            padding: "8px 16px",
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            cursor: loading || question.trim().length === 0 ? "not-allowed" : "pointer",
            fontFamily: "var(--font-geist-sans), sans-serif",
            transition: "all 0.15s ease"
          }}
        >
          {loading ? "Pensando..." : "Preguntar"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: "16px", padding: "12px", border: "1px solid rgba(248,113,113,0.2)", background: "rgba(248,113,113,0.05)", color: "#f87171", fontSize: "13px" }}>
          {error}
        </div>
      )}

      {answer && (
        <div style={{ marginTop: "16px", padding: "16px", border: `1px solid ${C.border}`, background: C.bg, color: C.dim, fontSize: "13px", lineHeight: "1.6", whiteSpace: "pre-wrap", fontFamily: "var(--font-geist-sans), sans-serif" }}>
          {answer}
        </div>
      )}
    </div>
  );
}
