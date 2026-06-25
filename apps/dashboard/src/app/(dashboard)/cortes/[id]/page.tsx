import { notFound } from "next/navigation";
import Link from "next/link";

import { getCorteById, extractRevisionDocument } from "@/lib/corte-data";
import { RevisionDetailView } from "./RevisionDetailView";

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

  if (!revision) {
    return (
      <div style={{ background: "#080808", color: "#E8E0D0", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 14 }}>Este corte no tiene datos de revisión</p>
        <Link href="/cortes" style={{ fontSize: 12, color: "#C9A84C" }}>Volver al historial</Link>
      </div>
    );
  }

  return <RevisionDetailView revision={revision} corte={corte} />;
}
