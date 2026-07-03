import { ExternalLink, FileText, Image as ImageIcon, Mail } from "lucide-react";

import type { ReconciliationRun } from "@/lib/reconciliation-data";

export function EmailEvidence({ run }: { run: ReconciliationRun }) {
  const body = String(run.email?.raw_metadata?.body_text ?? "").trim();
  const attachments = run.documents.filter((doc) => doc.source_system === "agent_mail");

  return (
    <section className="rounded-md border border-[#ded7ca] bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[1px] text-[#766f65]">
        <Mail className="h-4 w-4" /> Correo y evidencia
      </div>
      <div className="mb-4 rounded-md border border-[#ded7ca] bg-[#fbfaf7] p-3 text-sm text-[#282521]">
        <p className="font-semibold">{run.email?.subject ?? "Correo de Corte"}</p>
        <p className="mt-1 text-xs text-[#766f65]">{run.email?.from_address ?? "Remitente no disponible"}</p>
        <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[#4d4842]">
          {body || "El cuerpo no fue conservado en los correos anteriores. Los próximos ingresos lo guardarán automáticamente."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {attachments.map((doc) => {
          const name = String(doc.metadata.original_filename ?? doc.metadata.name ?? doc.document_key);
          const contentType = String(doc.metadata.content_type ?? "");
          const image = contentType.startsWith("image/");
          return (
            <a key={doc.id} href={doc.view_url ?? doc.source_uri ?? "#"} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-md border border-[#ded7ca] bg-[#fbfaf7]">
              {image && doc.view_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={doc.view_url} alt={name} className="h-36 w-full object-cover" />
              ) : (
                <div className="flex h-20 items-center justify-center text-[#766f65]">{image ? <ImageIcon /> : <FileText />}</div>
              )}
              <div className="flex items-center justify-between gap-2 p-3 text-xs text-[#282521]">
                <span className="truncate">{name}</span><ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#766f65]" />
              </div>
            </a>
          );
        })}
        {attachments.length === 0 && <p className="text-xs text-[#766f65]">No hay adjuntos vinculados.</p>}
      </div>
    </section>
  );
}
