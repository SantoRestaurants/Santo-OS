"use client";

import { FileUp, CheckCircle2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { uploadBankFilesAndTrigger } from "./actions";

const LINE = "#ded7ca";
const PANEL = "#ffffff";
const GREEN = "#2e7d55";
const GOLD = "#e8463b";
const MUTED = "#766f65";
const INK = "#282521";

export function BankUploadForm({
  workflowRunId,
  businessDate,
  canUploadBanks,
  bankDocsCount,
}: {
  workflowRunId: string;
  businessDate: string;
  canUploadBanks: boolean;
  bankDocsCount: number;
}) {
  const [amexFile, setAmexFile] = useState<File | null>(null);
  const [banorteFile, setBanorteFile] = useState<File | null>(null);
  const amexRef = useRef<HTMLInputElement>(null);
  const banorteRef = useRef<HTMLInputElement>(null);

  const canSubmit = canUploadBanks && amexFile !== null && banorteFile !== null;

  return (
    <form action={uploadBankFilesAndTrigger} className="rounded-md border p-4" style={{ borderColor: LINE, background: "#fbfaf7" }}>
      <input type="hidden" name="workflowRunId" value={workflowRunId} />
      <input type="hidden" name="businessDate" value={businessDate} />

      <div className="mb-3 flex items-center gap-2 text-xs" style={{ color: MUTED }}>
        <UploadCloud className="h-4 w-4" />
        Cuentas de banco
      </div>

      {!canUploadBanks ? (
        <div className="rounded-md border px-3 py-3 text-xs text-center" style={{ borderColor: "#e4c58f", background: "#fff8ec", color: "#b8782d" }}>
          Aprobá la etapa Agent Mail primero para habilitar la carga de bancos.
        </div>
      ) : (
        <div className="space-y-3">
          {/* AMEX */}
          <input
            ref={amexRef}
            type="file"
            name="amexFile"
            accept=".xls,.xlsx,.csv"
            hidden
            onChange={(e) => setAmexFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => amexRef.current?.click()}
            className="flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-sm font-medium transition hover:opacity-90"
            style={{
              borderColor: amexFile ? "#bbf7d0" : LINE,
              background: amexFile ? "#f0fdf4" : PANEL,
              color: amexFile ? GREEN : INK,
            }}
          >
            <span className="flex items-center gap-2">
              {amexFile ? <CheckCircle2 className="h-4 w-4" /> : <FileUp className="h-4 w-4" />}
              {amexFile ? amexFile.name : "Seleccionar archivo AMEX"}
            </span>
            <span className="text-[10px] uppercase tracking-wide" style={{ color: MUTED }}>.xls .xlsx .csv</span>
          </button>

          {/* Banorte */}
          <input
            ref={banorteRef}
            type="file"
            name="banorteFile"
            accept=".csv,.xls,.xlsx"
            hidden
            onChange={(e) => setBanorteFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => banorteRef.current?.click()}
            className="flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-sm font-medium transition hover:opacity-90"
            style={{
              borderColor: banorteFile ? "#bbf7d0" : LINE,
              background: banorteFile ? "#f0fdf4" : PANEL,
              color: banorteFile ? GREEN : INK,
            }}
          >
            <span className="flex items-center gap-2">
              {banorteFile ? <CheckCircle2 className="h-4 w-4" /> : <FileUp className="h-4 w-4" />}
              {banorteFile ? banorteFile.name : "Seleccionar archivo Banorte"}
            </span>
            <span className="text-[10px] uppercase tracking-wide" style={{ color: MUTED }}>.csv .xls .xlsx</span>
          </button>

          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-2 w-full rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-[1px] transition disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90"
            style={{ background: canSubmit ? GREEN : "#bdb6aa", color: "#ffffff" }}
          >
            {!amexFile && !banorteFile
              ? "Seleccioná ambos archivos para continuar"
              : !amexFile
                ? "Falta archivo AMEX"
                : !banorteFile
                  ? "Falta archivo Banorte"
                  : "Subir y correr Bank Watcher"}
          </button>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-5" style={{ color: MUTED }}>
        {bankDocsCount > 0
          ? `Archivos bancarios ya registrados: ${bankDocsCount}.`
          : "Sin archivos bancarios registrados todavía."}{" "}
        Si falta configuración de Drive o GitHub, el sistema lo deja en revisión.
      </p>
    </form>
  );
}
