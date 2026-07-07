/**
 * Script para diagnosticar problemas de julio 1 y 2
 * 
 * Problemas reportados:
 * 1. Julio 2 muestra diferencia cuando Excel está bien
 * 2. Julio 1 y 2 sin forecast (resto del mes tiene)
 * 3. "Falta por entrar" no se muestra después de validar bancos julio 1
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnoseJuly() {
    console.log("🔍 Diagnosticando problemas de julio 1 y 2...\n");

    // 1. Check corte_daily_records for July 1 and 2
    console.log("📊 Checking corte_daily_records...");
    const { data: dailyRecords, error: drError } = await supabase
        .from("corte_daily_records")
        .select("*")
        .in("business_date", ["2026-07-01", "2026-07-02"])
        .order("business_date");

    if (drError) {
        console.error("Error fetching daily records:", drError);
    } else {
        console.log(`Found ${dailyRecords?.length || 0} daily records`);
        for (const record of dailyRecords || []) {
            console.log(`\n  ${record.business_date}:`);
            console.log(`    venta_bruta: ${record.venta_bruta}`);
            console.log(`    total_bruto: ${record.total_bruto}`);
            console.log(`    forecast_target: ${record.forecast_target}`);
            console.log(`    amex: ${record.amex}`);
            console.log(`    debito: ${record.debito}`);
            console.log(`    credito: ${record.credito}`);
            console.log(`    efectivo: ${record.efectivo}`);
            console.log(`    propinas: ${record.propinas}`);
        }
    }

    // 2. Check workflow_runs for July 1 and 2
    console.log("\n\n📋 Checking workflow_runs...");
    const { data: runs, error: runsError } = await supabase
        .from("workflow_runs")
        .select("id, business_date, status, source_channel, output_payload, created_at")
        .in("business_date", ["2026-07-01", "2026-07-02"])
        .eq("source_channel", "agent_mail")
        .order("business_date")
        .order("created_at", { ascending: false });

    if (runsError) {
        console.error("Error fetching runs:", runsError);
    } else {
        console.log(`Found ${runs?.length || 0} workflow runs`);
        for (const run of runs || []) {
            console.log(`\n  ${run.business_date} (${run.id.slice(0, 8)}...):`);
            console.log(`    status: ${run.status}`);
            console.log(`    created_at: ${run.created_at}`);

            const payload = run.output_payload as any;

            // Check revision_document
            const revision = payload?.revision_document;
            if (revision) {
                console.log(`    ✅ Has revision_document`);
                console.log(`      reconciliation_totals:`, revision.reconciliation_totals);

                // Check forecast in vta_por_dia
                const vtaPorDia = revision.vta_por_dia;
                if (vtaPorDia && Array.isArray(vtaPorDia)) {
                    const dayRow = vtaPorDia.find((r: any) => r.fecha === run.business_date);
                    if (dayRow) {
                        console.log(`      vta_por_dia for ${run.business_date}:`);
                        console.log(`        meta_vta: ${dayRow.meta_vta}`);
                        console.log(`        venta_real: ${dayRow.venta_real}`);
                        console.log(`        diferencia: ${dayRow.diferencia}`);
                    } else {
                        console.log(`      ⚠️  No vta_por_dia row for ${run.business_date}`);
                    }
                } else {
                    console.log(`      ⚠️  No vta_por_dia array`);
                }

                // Check falta_por_entrar
                const faltaPorEntrar = revision.falta_por_entrar;
                if (faltaPorEntrar && Object.keys(faltaPorEntrar).length > 0) {
                    console.log(`      falta_por_entrar:`, faltaPorEntrar);
                } else {
                    console.log(`      ⚠️  No falta_por_entrar data`);
                }
            } else {
                console.log(`    ❌ No revision_document`);
            }

            // Check bank_validation_status
            if (payload?.bank_validation_status) {
                console.log(`    bank_validation_status: ${payload.bank_validation_status}`);
            }

            // Check drive_file_ids
            const driveIds = payload?.drive_file_ids;
            if (driveIds) {
                console.log(`    drive_file_ids:`, driveIds);
            }
        }
    }

    // 3. Check for forecast documents
    console.log("\n\n📁 Checking forecast documents...");
    const { data: docs, error: docsError } = await supabase
        .from("documents")
        .select("*")
        .eq("document_type", "forecast_workbook")
        .order("created_at", { ascending: false })
        .limit(5);

    if (docsError) {
        console.error("Error fetching documents:", docsError);
    } else {
        console.log(`Found ${docs?.length || 0} forecast documents`);
        for (const doc of docs || []) {
            console.log(`\n  ${doc.document_key}:`);
            console.log(`    created_at: ${doc.created_at}`);
            console.log(`    drive_file_id: ${doc.drive_file_id}`);
            console.log(`    metadata:`, doc.metadata);
        }
    }

    console.log("\n\n✅ Diagnosis complete");
}

diagnoseJuly().catch(console.error);
