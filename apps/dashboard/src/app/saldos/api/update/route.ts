import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return NextResponse.json({ error: "No Supabase config" }, { status: 500 });
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No auth" }, { status: 401 });

    const serviceClient = createSupabaseServiceClient();
    if (!serviceClient) return NextResponse.json({ error: "No service client" }, { status: 500 });

    const formData = await request.formData();
    const aguinaldosRaw = formData.get("aguinaldos");
    const utilidadesRaw = formData.get("utilidades");
    const note = formData.get("note")?.toString() || "Actualización manual de saldos";

    const aguinaldos = Number(aguinaldosRaw);
    const utilidades = Number(utilidadesRaw);

    if (isNaN(aguinaldos) || isNaN(utilidades)) {
      return NextResponse.json({ error: "Valores inválidos" }, { status: 400 });
    }

    // Get the latest run to update its saldos
    const { data: runs } = await serviceClient
      .from("workflow_runs")
      .select("id, output_payload")
      .order("business_date", { ascending: false })
      .limit(1);

    if (!runs || runs.length === 0) {
      return NextResponse.json({ error: "No runs found" }, { status: 404 });
    }

    const latestRun = runs[0];
    const payload = (latestRun.output_payload || {}) as Record<string, unknown>;
    const saldos = (payload.saldos || {}) as Record<string, number>;
    
    saldos.aguinaldos = aguinaldos;
    saldos.utilidades = utilidades;
    payload.saldos = saldos;

    await serviceClient
      .from("workflow_runs")
      .update({ output_payload: payload })
      .eq("id", latestRun.id);

    await serviceClient.from("events").insert({
      aggregate_type: "workflow_run",
      aggregate_id: latestRun.id,
      event_type: "saldos.manual_update",
      severity: "info",
      payload: { aguinaldos, utilidades, note, user: user.email },
    });

    return NextResponse.redirect(new URL("/saldos?success=Guardado", request.url));
  } catch (err: any) {
    return NextResponse.redirect(new URL(`/saldos?error=${encodeURIComponent(err.message)}`, request.url));
  }
}
