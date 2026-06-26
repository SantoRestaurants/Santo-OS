import { getReconciliationData } from "@/lib/reconciliation-data";

export default async function TestPage() {
  const data = await getReconciliationData();

  return (
    <main style={{ padding: 40, fontFamily: "monospace" }}>
      <h1>Test Auth Page</h1>
      <pre>{JSON.stringify({ status: data.status, error: data.error, runsCount: data.runs.length }, null, 2)}</pre>
    </main>
  );
}
