"use client";

import { useState } from "react";
import { Check, X, Edit2 } from "lucide-react";

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const GOLD = "#e8463b";

type InlineEditTableProps = {
  runId: string;
  returnTo: string;
  amex: number;
  debito: number;
  credito: number;
  efectivo: number;
  paypal: number;
  uber: number;
  rappi: number;
  propinas: number;
  total: number;
};

export function InlineEditTable({ runId, returnTo, amex, debito, credito, efectivo, paypal, uber, rappi, propinas, total }: InlineEditTableProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [editNote, setEditNote] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const money = (val: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(val);

  const handleEdit = (field: string, value: number) => {
    setEditingField(field);
    setEditValue(value.toString());
    setEditNote("");
  };

  const handleCancel = () => {
    setEditingField(null);
    setEditValue("");
    setEditNote("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingField || !editValue || isSubmitting) return;

    setIsSubmitting(true);
    const formData = new FormData();
    formData.append("workflowRunId", runId);
    formData.append("returnTo", returnTo);
    formData.append("field", `income_register.${editingField}`);
    formData.append("value", editValue);
    formData.append("note", editNote || "Corrección manual desde tabla");

    try {
      // In a real Server Action component, we'd import saveManualCorrection directly
      // but since we can't easily pass it from a client component without props drilling,
      // we'll submit it to the form action using standard HTML form submission.
      const form = e.target as HTMLFormElement;
      form.submit();
    } catch (err) {
      console.error("Failed to submit correction", err);
      setIsSubmitting(false);
    }
  };

  const Cell = ({ field, value, isGold = false }: { field: string, value: number, isGold?: boolean }) => {
    if (editingField === field) {
      return (
        <td className="px-2 py-2 min-w-[200px] border" style={{ borderColor: GOLD, background: "#fffaf0" }}>
          <form action="/cortes/api/correct" method="POST" onSubmit={handleSubmit} className="flex flex-col gap-2">
            <input type="hidden" name="action" value="saveManualCorrection" />
            <div className="flex gap-1">
              <input 
                autoFocus
                type="number" 
                step="0.01"
                value={editValue} 
                onChange={e => setEditValue(e.target.value)} 
                className="w-full rounded border px-2 py-1 text-xs"
                style={{ borderColor: LINE, color: INK }}
                placeholder="Valor"
                required
              />
              <button type="submit" disabled={isSubmitting} className="rounded p-1 text-white disabled:opacity-50" style={{ background: GOLD }}>
                <Check className="h-3 w-3" />
              </button>
              <button type="button" onClick={handleCancel} disabled={isSubmitting} className="rounded border p-1" style={{ borderColor: LINE, color: MUTED }}>
                <X className="h-3 w-3" />
              </button>
            </div>
            <input 
              type="text" 
              value={editNote} 
              onChange={e => setEditNote(e.target.value)} 
              className="w-full rounded border px-2 py-1 text-xs"
              style={{ borderColor: LINE, color: INK }}
              placeholder="Motivo (opcional)"
            />
          </form>
        </td>
      );
    }

    return (
      <td className="px-2 py-2 text-right group relative cursor-pointer hover:bg-gray-50" style={{ color: isGold ? GOLD : INK, fontWeight: isGold ? 600 : 400 }} onClick={() => handleEdit(field, value)}>
        <div className="flex items-center justify-end gap-2">
          <Edit2 className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: MUTED }} />
          <span>{money(value)}</span>
        </div>
      </td>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${LINE}` }}>
            <th className="px-2 py-2 text-left font-semibold" style={{ color: MUTED }}>RESTAURANTE</th>
            <th className="px-2 py-2 text-right font-semibold" style={{ color: MUTED }}>Amex</th>
            <th className="px-2 py-2 text-right font-semibold" style={{ color: MUTED }}>Debito</th>
            <th className="px-2 py-2 text-right font-semibold" style={{ color: MUTED }}>Credito</th>
            <th className="px-2 py-2 text-right font-semibold" style={{ color: MUTED }}>EFECTIVO</th>
            <th className="px-2 py-2 text-right font-semibold" style={{ color: MUTED }}>TOTAL</th>
            <th className="px-2 py-2 text-right font-semibold" style={{ color: MUTED }}>PAYPAL</th>
            <th className="px-2 py-2 text-right font-semibold" style={{ color: MUTED }}>UBEREATS</th>
            <th className="px-2 py-2 text-right font-semibold" style={{ color: MUTED }}>RAPPI</th>
            <th className="px-2 py-2 text-right font-semibold" style={{ color: MUTED }}>Propinas</th>
            <th className="px-2 py-2 text-right font-semibold" style={{ color: MUTED }}>Venta Bruta</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-2 py-2 font-semibold" style={{ color: INK }}>Valores</td>
            <Cell field="amex" value={amex} />
            <Cell field="debito" value={debito} />
            <Cell field="credito" value={credito} />
            <Cell field="efectivo" value={efectivo} />
            <td className="px-2 py-2 text-right font-semibold" style={{ color: GOLD }}>{money(amex + debito + credito + efectivo)}</td>
            <Cell field="paypal" value={paypal} />
            <Cell field="uber" value={uber} />
            <Cell field="rappi" value={rappi} />
            <Cell field="propinas" value={propinas} />
            <td className="px-2 py-2 text-right font-semibold" style={{ color: GOLD }}>{money(total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-right" style={{ color: MUTED }}>Clickeá en un valor para corregirlo. Todo cambio genera auditoría.</p>
    </div>
  );
}
