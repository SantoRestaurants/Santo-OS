import { notFound } from "next/navigation";
import Link from "next/link";

import { getCorteById, extractRevisionDocument } from "@/lib/corte-data";
import { RevisionDetailView } from "./RevisionDetailView";
import { getReconciliationData } from "@/lib/reconciliation-data";
import { dailySales } from "@/lib/corte-dashboard-utils";
import { EmailEvidence } from "@/components/cortes/EmailEvidence";
import { InlineEditTable } from "../InlineEditTable";

export default async function CorteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status, corte, error } = await getCorteById(id);

  if (status === "auth_required") {
    return (
      <div style={{ background: "#080808", color: "#E8E0D0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 14 }}>Inicia sesión para ver este corte</p>
      </div>
    );
  }

  if (!corte || error) {
    notFound();
  }

  const revision = extractRevisionDocument(corte);
  const reconciliation = await getReconciliationData();
  const run = reconciliation.runs.find((item) => item.id === id) ?? null;

  if (!revision) {
    return (
      <div style={{ background: "#080808", color: "#E8E0D0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 14 }}>Este corte no tiene datos de revisión</p>
        <Link href="/cortes" style={{ fontSize: 12, color: "#C9A84C" }}>Volver al historial</Link>
      </div>
    );
  }

  const register = (run?.output_payload.income_register ?? {}) as Record<string, number>;
  const daily = (run?.output_payload.daily_record ?? {}) as Record<string, number>;
  return (
    <div style={{ background: "#080808", minHeight: "100vh" }}>
      <RevisionDetailView revision={revision} corte={corte} />
      {run && (
        <div className="mx-auto max-w-7xl space-y-4 px-6 pb-10">
          <div className="rounded-md bg-white p-4">
            <InlineEditTable
              runId={run.id} returnTo={`/cortes/${run.id}`}
              amex={Number(daily.amex ?? register.amex ?? 0)} debito={Number(daily.debito ?? register.debito ?? 0)}
              credito={Number(daily.credito ?? register.credito ?? 0)} efectivo={Number(daily.efectivo ?? register.efectivo ?? 0)}
              transferencia={Number(daily.transferencia ?? register.transferencia ?? 0)} paypal={Number(daily.paypal ?? register.paypal ?? 0)}
              uber={Number(daily.uber_eats ?? register.uber ?? 0)} rappi={Number(daily.rappi ?? register.rappi ?? 0)}
              propinas={Number(daily.propinas ?? register.propinas ?? 0)}
              totalBruto={Number(daily.total_bruto ?? revision.daily_financial_record?.total_bruto ?? 0)}
              ventaBruta={Number(daily.venta_bruta ?? revision.daily_financial_record?.venta_bruta ?? dailySales(run))}
            />
          </div>
          <EmailEvidence run={run} />
        </div>
      )}
    </div>
  );
}
