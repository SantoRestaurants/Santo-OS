"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

import { approveAgentMailStage } from "./actions";

const INK = "#282521";
const MUTED = "#766f65";
const LINE = "#ded7ca";
const PANEL = "#ffffff";
const GOLD = "#e8463b";

type ApprovalFormProps = {
  workflowRunId: string;
  approved: boolean;
};

export function ApprovalForm({ workflowRunId, approved }: ApprovalFormProps) {
  return (
    <form action={approveAgentMailStage} className="rounded-md border p-4" style={{ borderColor: LINE, background: "#fbfaf7" }}>
      <input type="hidden" name="workflowRunId" value={workflowRunId} />
      <div className="mb-3 flex items-center gap-2 text-xs" style={{ color: MUTED }}>
        <CheckCircle2 className="h-4 w-4" />
        Aprobación de supervisora
      </div>
      <textarea
        name="notes"
        rows={3}
        placeholder="Notas de revisión"
        className="w-full rounded-md border px-3 py-2 text-sm outline-none disabled:opacity-60"
        style={{ borderColor: LINE, background: PANEL, color: INK }}
        defaultValue={approved ? "Aprobado" : ""}
        disabled={approved}
      />
      <ApprovalButton approved={approved} />
    </form>
  );
}

function ApprovalButton({ approved }: { approved: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={approved || pending}
      aria-live="polite"
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-xs font-semibold uppercase tracking-[1px] disabled:cursor-not-allowed disabled:opacity-60"
      style={{ background: approved ? "#2e7d55" : GOLD, color: "#ffffff" }}
    >
      {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}
      {pending ? "Aprobando…" : approved ? "Aprobado" : "Aprobar"}
    </button>
  );
}
