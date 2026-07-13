"use client";

import { useState } from "react";
import { Check, Edit2, X } from "lucide-react";

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const GOLD = "#e8463b";

type Props = {
  runId: string;
  returnTo: string;
  amex: number;
  debito: number;
  credito: number;
  efectivo: number;
  transferencia: number;
  paypal: number;
  uber: number;
  rappi: number;
  propinas: number;
  ventaBruta: number;
  totalBruto: number;
};

const GROUPS = [
  { label: "Terminales", fields: [["amex", "AMEX"], ["debito", "Débito"], ["credito", "Crédito"]] },
  { label: "Caja y transferencias", fields: [["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["paypal", "PayPal"]] },
  { label: "Plataformas", fields: [["uber", "Uber Eats"], ["rappi", "Rappi"]] },
  { label: "Complementos", fields: [["propinas", "Propinas"]] },
] as const;

export function InlineEditTable(props: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const values: Record<string, number> = {
    amex: props.amex, debito: props.debito, credito: props.credito,
    efectivo: props.efectivo, transferencia: props.transferencia,
    paypal: props.paypal, uber: props.uber, rappi: props.rappi,
    propinas: props.propinas,
  };
  const money = (amount: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(amount);

  function begin(field: string, amount: number) {
    setEditing(field);
    setValue(String(amount));
    setNote("");
  }

  function cancel() {
    setEditing(null);
    setValue("");
    setNote("");
  }

  return (
    <div className="min-w-0">
      <div className="grid gap-3 md:grid-cols-2">
        {GROUPS.map((group) => (
          <section key={group.label} className="rounded-md border p-3" style={{ borderColor: LINE, background: "#ffffff" }}>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[1px]" style={{ color: GOLD }}>{group.label}</div>
            <div className="space-y-1.5">
              {group.fields.map(([field, label]) => editing === field ? (
                <form key={field} action="/cortes/api/correct" method="POST" onSubmit={() => setSubmitting(true)} className="rounded-md border p-2.5" style={{ borderColor: GOLD, background: "#fffaf0" }}>
                  <input type="hidden" name="workflowRunId" value={props.runId} />
                  <input type="hidden" name="returnTo" value={props.returnTo} />
                  <input type="hidden" name="field" value={`income_register.${field}`} />
                  <label className="mb-2 block text-[11px] font-semibold" style={{ color: MUTED }}>{label}</label>
                  <div className="flex min-w-0 gap-1">
                    <input autoFocus name="value" type="number" step="0.01" value={value} onChange={(event) => setValue(event.target.value)} className="min-w-0 flex-1 rounded border px-2 py-1.5 text-sm" style={{ borderColor: LINE, color: INK }} required />
                    <button type="submit" disabled={submitting} aria-label={`Guardar ${label}`} className="rounded p-1.5 text-white disabled:opacity-50" style={{ background: GOLD }}><Check className="h-4 w-4" /></button>
                    <button type="button" onClick={cancel} disabled={submitting} aria-label={`Cancelar edición de ${label}`} className="rounded border p-1.5" style={{ borderColor: LINE, color: MUTED }}><X className="h-4 w-4" /></button>
                  </div>
                  <input name="note" value={note} onChange={(event) => setNote(event.target.value)} className="mt-2 w-full rounded border px-2 py-1.5 text-xs" style={{ borderColor: LINE, color: INK }} placeholder="Motivo (opcional)" />
                </form>
              ) : (
                <button key={field} type="button" onClick={() => begin(field, values[field] ?? 0)} className="group flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-2 text-left hover:bg-[#fbfaf7]" aria-label={`Editar ${label}`}>
                  <span className="text-xs" style={{ color: MUTED }}>{label}</span>
                  <span className="flex shrink-0 items-center gap-2 text-sm font-semibold tabular-nums" style={{ color: INK }}>{money(values[field] ?? 0)}<Edit2 className="h-3.5 w-3.5 opacity-40 group-hover:opacity-100" style={{ color: GOLD }} /></span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Summary label="Total Bruto" value={money(props.totalBruto)} />
        <Summary label="Venta Bruta" value={money(props.ventaBruta)} accent />
      </div>
      <p className="mt-2 text-xs" style={{ color: MUTED }}>Seleccioná un valor para corregirlo. Todo cambio queda auditado.</p>
    </div>
  );
}

function Summary({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <div className="rounded-md border p-3" style={{ borderColor: accent ? GOLD : LINE }}><div className="text-[11px] uppercase" style={{ color: MUTED }}>{label}</div><div className="mt-1 font-semibold" style={{ color: accent ? GOLD : INK }}>{value}</div></div>;
}
