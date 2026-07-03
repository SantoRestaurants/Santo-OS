import { Mail } from "lucide-react";

import type { ReconciliationRun } from "@/lib/reconciliation-data";

export function EmailEvidence({ run }: { run: ReconciliationRun }) {
  const body = String(run.email?.raw_metadata?.body_text ?? "").trim();
  return (
    <section className="rounded-md border border-[#ded7ca] bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[1px] text-[#766f65]">
        <Mail className="h-4 w-4" /> Correo original
      </div>
      <div className="rounded-md border border-[#ded7ca] bg-[#fbfaf7] p-3 text-sm text-[#282521]">
        <p className="font-semibold">{run.email?.subject ?? "Correo de Corte"}</p>
        <p className="mt-1 text-xs text-[#766f65]">{run.email?.from_address ?? "Remitente no disponible"}</p>
        <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#4d4842]">
          {body || "El cuerpo no fue conservado en los correos anteriores. Los próximos ingresos lo guardarán automáticamente."}
        </p>
      </div>
    </section>
  );
}
