/**
 * Script para corregir julio 2
 * 
 * Problemas encontrados:
 * 1. Débito en dashboard: $24,574.43 pero Excel dice: $24,219.65 (diferencia: $354.78)
 * 2. Total Real calculado: $164,536.69 pero debería ser $162,171.69 (diferencia: $2,365.00)
 * 3. Sin forecast
 * 4. Sin "falta por entrar"
 * 
 * Datos correctos del Excel julio 2:
 * - AMEX: $32,729.25
 * - Débito: $24,219.65
 * - Crédito: $86,898.24
 * - Efectivo: $13,024.80
 * - Total Bruto: $162,171.69
 * - Venta Bruta: $144,433.80
 * - Propinas: $17,737.89
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Load .env.local
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    envContent.split("\n").forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match && !process.env[match[1]]) {
            process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
        }
    });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Datos correctos del Excel
const CORRECT_DATA = {
    business_date: "2026-07-02",
    amex: 32729.25,
    debito: 24219.65,  // ← CORREGIDO (estaba 24574.43)
    credito: 86898.24,
    efectivo: 13024.80,
    transferencia: 1360.00,
    paypal: 0.00,
    uber_eats: 2465.00,
    rappi: 1120.00,
    propinas: 17737.89,
    total_bruto: 162171.69,  // ← CORRECTO
    venta_bruta: 144433.80,
};

async function fixJuly2() {
    console.log("🔧 Corrigiendo julio 2...\n");

    // 1. Corregir corte_daily_records
    console.log("📊 Step 1: Actualizando corte_daily_records...");

    const { data: existing, error: fetchError } = await supabase
        .from("corte_daily_records")
        .select("*")
        .eq("business_date", CORRECT_DATA.business_date)
        .single();

    if (fetchError) {
        console.error("❌ Error fetching record:", fetchError);
        return;
    }

    console.log("\n  Valores actuales:");
    console.log(`    debito: ${existing.debito} → ${CORRECT_DATA.debito}`);
    console.log(`    total_bruto: ${existing.total_bruto} → ${CORRECT_DATA.total_bruto}`);
    console.log(`    venta_bruta: ${existing.venta_bruta} → ${CORRECT_DATA.venta_bruta}`);

    const { error: updateError } = await supabase
        .from("corte_daily_records")
        .update({
            amex: CORRECT_DATA.amex,
            debito: CORRECT_DATA.debito,
            credito: CORRECT_DATA.credito,
            efectivo: CORRECT_DATA.efectivo,
            transferencia: CORRECT_DATA.transferencia,
            paypal: CORRECT_DATA.paypal,
            uber_eats: CORRECT_DATA.uber_eats,
            rappi: CORRECT_DATA.rappi,
            propinas: CORRECT_DATA.propinas,
            total_bruto: CORRECT_DATA.total_bruto,
            venta_bruta: CORRECT_DATA.venta_bruta,
            total: CORRECT_DATA.venta_bruta + CORRECT_DATA.propinas,
        })
        .eq("business_date", CORRECT_DATA.business_date);

    if (updateError) {
        console.error("❌ Error updating daily records:", updateError);
        return;
    }

    console.log("✅ corte_daily_records actualizado\n");

    // 2. Actualizar workflow_run
    console.log("📋 Step 2: Actualizando workflow_run...");

    const { data: run, error: runFetchError } = await supabase
        .from("workflow_runs")
        .select("id, output_payload")
        .eq("business_date", CORRECT_DATA.business_date)
        .eq("source_channel", "agent_mail")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

    if (runFetchError) {
        console.error("❌ Error fetching workflow run:", runFetchError);
        return;
    }

    const payload = run.output_payload as any;

    // Actualizar income_register
    if (payload.income_register) {
        payload.income_register.amex = CORRECT_DATA.amex;
        payload.income_register.debito = CORRECT_DATA.debito;
        payload.income_register.credito = CORRECT_DATA.credito;
        payload.income_register.efectivo = CORRECT_DATA.efectivo;
        payload.income_register.transferencia = CORRECT_DATA.transferencia;
        payload.income_register.paypal = CORRECT_DATA.paypal;
        payload.income_register.uber = CORRECT_DATA.uber_eats;
        payload.income_register.rappi = CORRECT_DATA.rappi;
        payload.income_register.propinas = CORRECT_DATA.propinas;
        payload.income_register.bancos = CORRECT_DATA.debito + CORRECT_DATA.credito;
        payload.income_register.plataformas = CORRECT_DATA.uber_eats + CORRECT_DATA.rappi;
        console.log("  ✓ income_register actualizado");
    }

    // Actualizar revision_document.reconciliation_totals
    if (payload.revision_document) {
        const totalReal = CORRECT_DATA.total_bruto;
        const totalSistema = payload.revision_document.reconciliation_totals?.total_sistema || totalReal;

        payload.revision_document.reconciliation_totals = {
            total_real: totalReal,
            total_sistema: totalSistema,
            difference: totalReal - totalSistema,
            tolerance: 0,
        };

        console.log("  ✓ reconciliation_totals actualizado:");
        console.log(`    Total Real: ${totalReal}`);
        console.log(`    Total Sistema: ${totalSistema}`);
        console.log(`    Diferencia: ${totalReal - totalSistema}`);

        // Actualizar daily_financial_record
        if (payload.revision_document.daily_financial_record) {
            payload.revision_document.daily_financial_record.venta_bruta = CORRECT_DATA.venta_bruta;
            payload.revision_document.daily_financial_record.total_bruto = CORRECT_DATA.total_bruto;
            console.log("  ✓ daily_financial_record actualizado");
        }
    }

    // Guardar cambios
    const { error: updateRunError } = await supabase
        .from("workflow_runs")
        .update({ output_payload: payload })
        .eq("id", run.id);

    if (updateRunError) {
        console.error("❌ Error updating workflow run:", updateRunError);
        return;
    }

    console.log("✅ workflow_run actualizado\n");

    // 3. Resumen
    console.log("=".repeat(50));
    console.log("✅ JULIO 2 CORREGIDO");
    console.log("=".repeat(50));
    console.log("\nCambios aplicados:");
    console.log(`  • Débito: $24,574.43 → $24,219.65`);
    console.log(`  • Total Bruto: $162,171.72 → $162,171.69`);
    console.log(`  • Venta Bruta: $144,433.83 → $144,433.80`);
    console.log(`  • Total Real ahora coincide con Excel`);
    console.log("\nPendiente:");
    console.log(`  • Forecast (requiere re-procesamiento o actualización manual)`);
    console.log(`  • Falta por entrar (requiere ejecutar bank watcher)`);
    console.log("\n💡 Refrescá el dashboard para ver los cambios");
}

fixJuly2().catch(console.error);
