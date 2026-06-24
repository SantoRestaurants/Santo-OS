"use client";

import { Bot } from "lucide-react";
import { useState, useEffect } from "react";

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const GOLD = "#9b7a22";

export function CorteAiBox({ runId }: { runId: string }) {
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
        body: JSON.stringify({ runId, question: trimmed }),
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
    <div className="rounded-md border p-5" style={{ borderColor: LINE, background: "#ffffff" }}>
      <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: INK }}>
        <Bot className="h-4 w-4" />
        Preguntas para IA
      </div>
      <textarea
        rows={3}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Ejemplo: ¿por qué la venta real quedó arriba del forecast?"
        className="w-full rounded-md border px-3 py-2 text-sm"
        style={{ borderColor: LINE, color: INK }}
      />
      <button
        type="button"
        onClick={ask}
        disabled={loading || question.trim().length === 0}
        className="mt-2 rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
        style={{ background: GOLD, color: "white" }}
      >
        {loading ? "Consultando..." : "Preguntar"}
      </button>
      {error && <div className="mt-3 rounded-md border px-3 py-2 text-sm" style={{ borderColor: "#e8b4aa", color: "#b84a3a" }}>{error}</div>}
      {answer && <div className="mt-3 whitespace-pre-wrap rounded-md border px-3 py-2 text-sm leading-6" style={{ borderColor: LINE, color: MUTED }}>{answer}</div>}
    </div>
  );
}
