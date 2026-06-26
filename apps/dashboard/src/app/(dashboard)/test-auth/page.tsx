import { getReconciliationData, type ReconciliationRun } from "@/lib/reconciliation-data";
import { dedupeRunsByDay } from "@/lib/corte-dashboard-utils";

function getUnit(run: ReconciliationRun) {
  return (run.revision?.unidad || run.revision?.restaurant_key || "SANTO").toUpperCase();
}

export default async function TestPage() {
  const data = await getReconciliationData();

  if (data.status !== "ready") {
    return <main style={{ padding: 40 }}>Status: {data.status}</main>;
  }

  const allRuns = data.runs.filter(r => r.business_date);
  const runs = dedupeRunsByDay(allRuns);
  const units = Array.from(new Set(runs.map(getUnit))).sort();
  const months = Array.from(new Set(runs.map(r => r.business_date?.slice(0, 7) || "?"))).sort().reverse();

  return (
    <main style={{ padding: 40, fontFamily: "monospace" }}>
      <h1>Test Render</h1>
      <p>Runs: {runs.length} | Units: {units.join(", ")} | Months: {months.length}</p>
    </main>
  );
}
