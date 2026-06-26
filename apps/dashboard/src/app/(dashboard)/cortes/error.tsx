"use client";

import { useEffect } from "react";

const INK = "#282521";
const MUTED = "#766f65";
const GOLD = "#e8463b";
const PAPER = "#fbfaf7";

export default function CortesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Cortes page error:", error);
  }, [error]);

  return (
    <main
      className="flex min-h-screen items-center justify-center flex-col gap-4 px-4"
      style={{ background: PAPER, color: INK }}
    >
      <div className="text-xl font-bold">Error al cargar el panel</div>
      <div className="text-sm max-w-md text-center" style={{ color: MUTED }}>
        {error.message || "Ocurrio un error inesperado."}
      </div>
      {error.digest && (
        <div className="text-xs" style={{ color: "#aaa298" }}>
          Digest: {error.digest}
        </div>
      )}
      <button
        onClick={reset}
        className="mt-4 rounded-md px-4 py-2 text-sm font-semibold"
        style={{ background: GOLD, color: "#ffffff" }}
      >
        Reintentar
      </button>
    </main>
  );
}
