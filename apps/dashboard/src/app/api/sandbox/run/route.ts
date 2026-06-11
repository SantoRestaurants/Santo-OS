import { exec } from "child_process";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { readFile } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import path from "path";
import os from "os";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

function getWorkspaceRoot() {
  let current = process.cwd();
  while (!existsSync(path.join(current, "workflows")) && path.dirname(current) !== current) {
    current = path.dirname(current);
  }
  return current;
}

function generateCorteSantoPdf(payload: any, status: string, exceptions: any[]): Buffer {
  const businessDate = payload.business_date || "2026-06-08";
  const restaurantKey = payload.restaurant_key || "santo_unidad_1";
  const salesTotal = typeof payload.sales_total === "number" ? payload.sales_total : 5450.0;
  const bankDeposit = typeof payload.bank_deposit === "number" ? payload.bank_deposit : 5000.0;
  const cashCount = typeof payload.cash_count === "number" ? payload.cash_count : 450.0;
  const diff = Math.abs(salesTotal - (bankDeposit + cashCount));

  const title = `Reporte de Cierre Diario: Reconciliacion Corte Santo`;
  const cleanStr = (str: string) => String(str).replace(/[()]/g, "");

  const lines: string[] = [
    "BT",
    "/F1 18 Tf",
    "50 750 Td",
    `(${cleanStr(title)}) Tj`,
    "ET",
    "BT",
    "/F1 12 Tf",
    "50 710 Td",
    `(Fecha de Operacion: ${cleanStr(businessDate)}) Tj`,
    "0 -20 Td",
    `(Unidad / Restaurante: ${cleanStr(restaurantKey)}) Tj`,
    "0 -25 Td",
    `(Ventas Totales del Cierre: $${salesTotal.toFixed(2)}) Tj`,
    "0 -20 Td",
    `(Deposito Bancario Declarado: $${bankDeposit.toFixed(2)}) Tj`,
    "0 -20 Td",
    `(Efectivo Contado en Caja: $${cashCount.toFixed(2)}) Tj`,
    "0 -20 Td",
    `(Suma Declarada (Banco + Caja): $${(bankDeposit + cashCount).toFixed(2)}) Tj`,
    "0 -20 Td",
    `(Diferencia de Cierre: $${diff.toFixed(2)}) Tj`,
    "0 -30 Td",
    `(Estatus de Reconciliacion: ${cleanStr(status === "requires_review" ? "REQUIERE REVISION HUMANA" : "CONCILIADO OK")}) Tj`,
  ];

  if (exceptions && exceptions.length > 0) {
    lines.push("0 -25 Td", `(Alertas y Discrepancias Detectadas:) Tj`);
    for (const exc of exceptions) {
      const reason = exc.details?.reason || exc.exception_type || "";
      lines.push("0 -15 Td", `( - [${cleanStr(exc.severity || "medium")}] ${cleanStr(exc.exception_key || "alerta")}: ${cleanStr(reason)}) Tj`);
    }
  }

  lines.push("ET");

  const streamContent = lines.join("\n");
  const streamObject = `5 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj`;

  const pdfParts: string[] = [
    "%PDF-1.4",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources 4 0 R /Contents 5 0 R >>\nendobj",
    "4 0 obj\n<< /Font << /F1 6 0 R >> >>\nendobj",
    streamObject,
    "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
  ];

  const offsets: number[] = [];
  let currentOffset = 0;
  const bodyBufferParts: Buffer[] = [];

  for (const part of pdfParts) {
    const partBuf = Buffer.from(part + "\n");
    offsets.push(currentOffset);
    bodyBufferParts.push(partBuf);
    currentOffset += partBuf.length;
  }

  const bodyBuffer = Buffer.concat(bodyBufferParts);

  let xref = `xref\n0 ${pdfParts.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${pdfParts.length + 1} /Root 1 0 R >>\nstartxref\n{currentOffset}\n%%EOF`;

  return Buffer.concat([
    bodyBuffer,
    Buffer.from(xref),
    Buffer.from(trailer)
  ]);
}

function generateBankDepositCsv(payload: any): Buffer {
  const businessDate = payload.business_date || "2026-06-08";
  const bankDeposit = typeof payload.bank_deposit === "number" ? payload.bank_deposit : 5000.0;

  const csvContent = [
    "Fecha,Concepto,Referencia,Monto,Estatus",
    `${businessDate},DEPOSITO DE VENTAS DIARIAS,REF-CONCILIACION-CS,${bankDeposit.toFixed(2)},APLICADO`
  ].join("\n");

  return Buffer.from(csvContent, "utf-8");
}

function generateXmlSat(payload: any): Buffer {
  const firstDoc = payload.documents?.[0];
  const xmlText = firstDoc?.xml_text;
  if (xmlText) {
    return Buffer.from(xmlText, "utf-8");
  }

  const total = typeof payload.sales_total === "number" ? payload.sales_total : 5450.0;
  const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="A" Folio="12345" Fecha="2026-06-08T18:00:00" SubTotal="${(total / 1.16).toFixed(2)}" Total="${total.toFixed(2)}" Moneda="MXN" TipoDeComprobante="I" Exportacion="01" MetodoPago="PUE" LugarExpedicion="06600">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="PROVEEDOR ALIMENTOS" RegimenFiscal="601"/>
  <cfdi:Receptor Rfc="BBB010101BBB" Nombre="SANTO RESTAURANTES" RegimenFiscal="601" DomicilioFiscalReceptor="06600" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="90101501" Cantidad="1.00" ClaveUnidad="ACT" Descripcion="Consumo de Alimentos" ValorUnitario="${(total / 1.16).toFixed(2)}" Importe="${(total / 1.16).toFixed(2)}">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="${(total / 1.16).toFixed(2)}" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="${(total - (total / 1.16)).toFixed(2)}"/>
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
</cfdi:Comprobante>`;
  return Buffer.from(xmlContent, "utf-8");
}

function generateUtilityReceiptPdf(payload: any): Buffer {
  const provider = payload.provider || "cfe";
  const amount = typeof payload.amount === "number" ? payload.amount : 3450.0;
  const dueDate = payload.due_date || "2026-06-08";
  const serviceNumber = payload.service_number || "123456789012";

  const title = `Recibo de Servicios Publicos - CFE / AGUA / GAS`;
  const cleanStr = (str: string) => String(str).replace(/[()]/g, "");

  const lines: string[] = [
    "BT",
    "/F1 18 Tf",
    "50 750 Td",
    `(${cleanStr(title)}) Tj`,
    "ET",
    "BT",
    "/F1 12 Tf",
    "50 700 Td",
    `(Proveedor: ${cleanStr(provider.toUpperCase())}) Tj`,
    "0 -20 Td",
    `(Numero de Servicio: ${cleanStr(serviceNumber)}) Tj`,
    "0 -25 Td",
    `(Monto de Facturacion: $${amount.toFixed(2)}) Tj`,
    "0 -20 Td",
    `(Fecha Limite de Pago: ${cleanStr(dueDate)}) Tj`,
    "0 -20 Td",
    `(Moneda: MXN) Tj`,
    "ET"
  ];

  const streamContent = lines.join("\n");
  const streamObject = `5 0 obj\n<< /Length ${streamContent.length} >>\nstream\n{streamContent}\nendstream\nendobj`;

  const pdfParts: string[] = [
    "%PDF-1.4",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources 4 0 R /Contents 5 0 R >>\nendobj",
    "4 0 obj\n<< /Font << /F1 6 0 R >> >>\nendobj",
    streamObject,
    "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
  ];

  const offsets: number[] = [];
  let currentOffset = 0;
  const bodyBufferParts: Buffer[] = [];

  for (const part of pdfParts) {
    const partBuf = Buffer.from(part + "\n");
    offsets.push(currentOffset);
    bodyBufferParts.push(partBuf);
    currentOffset += partBuf.length;
  }

  const bodyBuffer = Buffer.concat(bodyBufferParts);

  let xref = `xref\n0 ${pdfParts.length + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${pdfParts.length + 1} /Root 1 0 R >>\nstartxref\n{currentOffset}\n%%EOF`;

  return Buffer.concat([
    bodyBuffer,
    Buffer.from(xref),
    Buffer.from(trailer)
  ]);
}

export async function POST(req: NextRequest) {
  const tempFiles: string[] = [];
  try {
    const { workflow, scenario, driveSettings } = await req.json();

    if (!workflow || !scenario) {
      return NextResponse.json(
        { error: "Workflow y scenario son obligatorios." },
        { status: 400 }
      );
    }

    const rootDir = getWorkspaceRoot();

    // Map client workflow name to folder name
    const folderMap: Record<string, string> = {
      corte_santo: "corte_santo",
      xml_sat: "xml_sat_validation",
      utilities: "utilities",
    };

    const folderName = folderMap[workflow];
    if (!folderName) {
      return NextResponse.json({ error: "Workflow no soportado." }, { status: 400 });
    }

    const scriptPath = path.join(rootDir, "workflows", folderName, "script.py");
    const inputPath = path.join(rootDir, "workflows", folderName, "fixtures", `${scenario}.json`);
    const configPath = path.join(rootDir, "workflows", folderName, "fixtures", "config_confirmed.json");

    if (!existsSync(scriptPath)) {
      return NextResponse.json({ error: `Script no encontrado: ${scriptPath}` }, { status: 404 });
    }
    if (!existsSync(inputPath)) {
      return NextResponse.json({ error: `Scenario no encontrado: ${inputPath}` }, { status: 404 });
    }
    if (!existsSync(configPath)) {
      return NextResponse.json({ error: `Configuración no encontrada: ${configPath}` }, { status: 404 });
    }

    // Load inputs for UI convenience
    const inputJson = JSON.parse(await readFile(inputPath, "utf-8"));
    const configJson = JSON.parse(await readFile(configPath, "utf-8"));

    // Execute Python script
    const command = `python "${scriptPath}" --input "${inputPath}" --config "${configPath}"`;

    const workflowResult = await new Promise<any>((resolve, reject) => {
      exec(command, { cwd: rootDir }, (error, stdout, stderr) => {
        if (error) {
          reject({ error: "Error en script de Python", details: error.message, stderr, stdout });
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError: any) {
          reject({ error: "Salida de Python no es JSON válido", stdout, stderr, parseError: parseError.message });
        }
      });
    });

    // Write dynamic files containing the actual workflow/scenario closing numbers
    const payloadVal = workflowResult.workflow_run?.input_payload || inputJson.payload || {};
    const statusVal = workflowResult.status || "requires_review";
    const exceptionsVal = workflowResult.exceptions || [];

    if (workflow === "corte_santo") {
      const dynamicCortePdf = generateCorteSantoPdf(payloadVal, statusVal, exceptionsVal);
      const dynamicCortePdfPath = path.join(rootDir, "apps", "dashboard", "public", "fixtures", "corte-santo-2026-06-08.pdf");
      writeFileSync(dynamicCortePdfPath, dynamicCortePdf);

      const dynamicCsv = generateBankDepositCsv(payloadVal);
      const dynamicCsvPath = path.join(rootDir, "apps", "dashboard", "public", "fixtures", "deposito-banorte-2026-06-08.csv");
      writeFileSync(dynamicCsvPath, dynamicCsv);
    } else if (workflow === "xml_sat") {
      const dynamicXml = generateXmlSat(payloadVal);
      const dynamicXmlPath = path.join(rootDir, "apps", "dashboard", "public", "fixtures", "cfdi-proveedor-demo.xml");
      writeFileSync(dynamicXmlPath, dynamicXml);
    } else if (workflow === "utilities") {
      const dynamicUtilityPdf = generateUtilityReceiptPdf(payloadVal);
      const dynamicUtilityPdfPath = path.join(rootDir, "apps", "dashboard", "public", "fixtures", "recibo-cfe-junio.pdf");
      writeFileSync(dynamicUtilityPdfPath, dynamicUtilityPdf);
    }

    // Handle real Google Drive upload if enabled
    if (
      driveSettings?.enabled &&
      driveSettings.folderId &&
      driveSettings.accessToken &&
      workflowResult.documents &&
      workflowResult.documents.length > 0
    ) {
      const driveFolderId = driveSettings.folderId;
      const accessToken = driveSettings.accessToken;

      const updatedDocuments: any[] = [];
      const driveConnectorPath = path.join(rootDir, "services", "drive_connector", "connector.py");

      for (const doc of workflowResult.documents) {
        // Map document filename to our local public mock files
        let localFilename = doc.metadata?.original_filename || doc.document_key || "";
        let mockFilename = "";

        if (localFilename.includes("corte-santo") || doc.document_type === "daily_sales_report") {
          mockFilename = "corte-santo-2026-06-08.pdf";
        } else if (localFilename.includes("deposito") || localFilename.includes("banorte")) {
          mockFilename = "deposito-banorte-2026-06-08.csv";
        } else if (localFilename.includes("cfe") || localFilename.includes("recibo") || doc.document_type === "utility_receipt") {
          mockFilename = "recibo-cfe-junio.pdf";
        } else if (localFilename.includes("cfdi") || localFilename.endsWith(".xml") || doc.document_type === "xml_sat") {
          mockFilename = "cfdi-proveedor-demo.xml";
        } else {
          mockFilename = "corte-santo-2026-06-08.pdf"; // fallback
        }

        const mockFilePath = path.join(rootDir, "apps", "dashboard", "public", "fixtures", mockFilename);

        if (existsSync(mockFilePath)) {
          // Prepare drive connector config
          const connectorConfig = {
            confirmed: true,
            folder_map: {
              [workflow]: {
                folder_id: driveFolderId,
                drive_url: `https://drive.google.com/drive/folders/${driveFolderId}`,
                confirmation_status: "confirmed"
              }
            }
          };

          const connectorRequest = {
            dry_run: false,
            folder_key: workflow,
            filename: mockFilename, // Keep matching filename
            source_path: mockFilePath,
            document_key: doc.document_key,
            document_type: doc.document_type,
            source_hash: doc.source_hash || "mock-hash-value"
          };

          const tempConfigPath = path.join(os.tmpdir(), `santoos-drive-config-${Date.now()}.json`);
          const tempRequestPath = path.join(os.tmpdir(), `santoos-drive-request-${Date.now()}.json`);

          writeFileSync(tempConfigPath, JSON.stringify(connectorConfig));
          writeFileSync(tempRequestPath, JSON.stringify(connectorRequest));
          tempFiles.push(tempConfigPath, tempRequestPath);

          const connectorCmd = `python "${driveConnectorPath}" --input "${tempRequestPath}" --config "${tempConfigPath}"`;

          try {
            const driveUploadResult = await new Promise<any>((resolve, reject) => {
              exec(
                connectorCmd,
                {
                  cwd: rootDir,
                  env: { ...process.env, GOOGLE_DRIVE_ACCESS_TOKEN: accessToken }
                },
                (error, stdout, stderr) => {
                  if (error) {
                    reject({ error, stderr, stdout });
                    return;
                  }
                  try {
                    resolve(JSON.parse(stdout));
                  } catch (e) {
                    reject({ error: "Invalid JSON from drive connector", stdout, stderr });
                  }
                }
              );
            });

            if (driveUploadResult.status === "registered" && driveUploadResult.document) {
              updatedDocuments.push({
                ...doc,
                status: "registered",
                source_uri: driveUploadResult.document.source_uri,
                metadata: {
                  ...doc.metadata,
                  drive_file_id: driveUploadResult.document.drive_file_id,
                  google_drive_link: driveUploadResult.document.source_uri,
                  is_real_drive_upload: true
                }
              });

              // Add a nice audit event for the real upload
              if (workflowResult.events) {
                workflowResult.events.push({
                  aggregate_type: "document",
                  aggregate_id: null,
                  event_type: "drive.document.real_upload_succeeded",
                  severity: "info",
                  payload: {
                    filename: mockFilename,
                    drive_file_id: driveUploadResult.document.drive_file_id,
                    folder_id: driveFolderId
                  },
                  created_at: new Date().toISOString()
                });
              }

              // Update watchdog
              if (workflowResult.watchdog_log) {
                workflowResult.watchdog_log.push({
                  check_key: "google_drive.upload",
                  status: "ok",
                  severity: "info",
                  message: `Archivo '${mockFilename}' subido exitosamente a Google Drive real (ID: ${driveUploadResult.document.drive_file_id}).`,
                  metadata: {},
                  checked_at: new Date().toISOString()
                });
              }

            } else {
              // Failed upload state
              updatedDocuments.push({
                ...doc,
                status: "requires_review",
                metadata: {
                  ...doc.metadata,
                  upload_error: driveUploadResult.requires_review_reason || "unknown_error"
                }
              });
            }

          } catch (connectorErr: any) {
            console.error("Error executing drive connector script:", connectorErr);
            updatedDocuments.push({
              ...doc,
              status: "requires_review",
              metadata: {
                ...doc.metadata,
                upload_error: "connection_error",
                details: connectorErr.stderr || connectorErr.message
              }
            });
          }
        } else {
          updatedDocuments.push(doc);
        }
      }

      workflowResult.documents = updatedDocuments;
    }

    // Write to Supabase if service client is available
    const supabase = createSupabaseServiceClient();
    if (supabase && workflowResult && workflowResult.workflow_run) {
      try {
        // 1. Get workflow ID
        const { data: dbWorkflow, error: workflowError } = await supabase
          .from("workflows")
          .select("id")
          .eq("workflow_key", workflowResult.workflow_key)
          .single();

        if (workflowError || !dbWorkflow) {
          console.error("Error finding workflow in database:", workflowError);
        } else {
          // 2. We have the workflow ID. Let's resolve the workflow_run record.
          const runPayload = workflowResult.workflow_run;

          // Check if there is an existing run with this idempotency key and workflow_id to delete old dependencies
          const { data: existingRun } = await supabase
            .from("workflow_runs")
            .select("id")
            .eq("workflow_id", dbWorkflow.id)
            .eq("idempotency_key", runPayload.idempotency_key)
            .single();

          let runId: string;

          if (existingRun) {
            runId = existingRun.id;
            // Delete dependent records first to prevent foreign key issues
            await supabase.from("reviews").delete().eq("workflow_run_id", runId);
            await supabase.from("exceptions").delete().eq("workflow_run_id", runId);
            await supabase.from("tasks").delete().eq("workflow_run_id", runId);
            await supabase.from("documents").delete().eq("workflow_run_id", runId);

            // Update the workflow run
            const { error: updateError } = await supabase
              .from("workflow_runs")
              .update({
                business_date: runPayload.business_date || null,
                status: runPayload.status,
                source_channel: runPayload.source_channel || "dashboard",
                input_payload: runPayload.input_payload || {},
                config_snapshot: runPayload.config_snapshot || {},
                requires_review_reason: runPayload.requires_review_reason || null,
                finished_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq("id", runId);

            if (updateError) {
              console.error("Error updating workflow_runs:", updateError);
            }
          } else {
            // Insert new run
            const { data: newRun, error: insertRunError } = await supabase
              .from("workflow_runs")
              .insert({
                workflow_id: dbWorkflow.id,
                business_date: runPayload.business_date || null,
                status: runPayload.status,
                source_channel: runPayload.source_channel || "dashboard",
                idempotency_key: runPayload.idempotency_key,
                input_payload: runPayload.input_payload || {},
                config_snapshot: runPayload.config_snapshot || {},
                requires_review_reason: runPayload.requires_review_reason || null,
                finished_at: new Date().toISOString()
              })
              .select("id")
              .single();

            if (insertRunError || !newRun) {
              throw new Error(`Failed to insert workflow run: ${insertRunError?.message}`);
            }
            runId = newRun.id;
          }

          // 3. Insert documents
          if (workflowResult.documents && workflowResult.documents.length > 0) {
            const documentsToInsert = workflowResult.documents.map((doc: any) => {
              const driveFileId = doc.metadata?.drive_file_id || null;
              return {
                workflow_run_id: runId,
                document_key: doc.document_key,
                document_type: doc.document_type,
                source_system: doc.source_system || "dashboard_upload",
                source_uri: doc.source_uri,
                drive_file_id: driveFileId,
                source_hash: doc.source_hash,
                status: doc.status || "registered",
                metadata: doc.metadata || {},
              };
            });

            const { error: docsError } = await supabase
              .from("documents")
              .insert(documentsToInsert);
            if (docsError) {
              console.error("Error inserting documents:", docsError);
            }
          }

          // 4. Insert tasks
          let insertedTasks: any[] = [];
          if (workflowResult.tasks && workflowResult.tasks.length > 0) {
            const tasksToInsert = workflowResult.tasks.map((t: any) => ({
              workflow_run_id: runId,
              task_key: t.task_key,
              title: t.title,
              status: t.status || "pending",
              metadata: t.metadata || {},
            }));

            const { data: dbTasks, error: tasksError } = await supabase
              .from("tasks")
              .insert(tasksToInsert)
              .select("id, task_key");
            if (tasksError) {
              console.error("Error inserting tasks:", tasksError);
            } else {
              insertedTasks = dbTasks || [];
            }
          }

          // 5. Insert exceptions
          let insertedExceptions: any[] = [];
          if (workflowResult.exceptions && workflowResult.exceptions.length > 0) {
            const exceptionsToInsert = workflowResult.exceptions.map((e: any) => ({
              workflow_run_id: runId,
              exception_key: e.exception_key,
              exception_type: e.exception_type,
              severity: e.severity || "medium",
              status: e.status || "requires_review",
              details: e.details || {},
            }));

            const { data: dbExceptions, error: exceptionsError } = await supabase
              .from("exceptions")
              .insert(exceptionsToInsert)
              .select("id, exception_key");
            if (exceptionsError) {
              console.error("Error inserting exceptions:", exceptionsError);
            } else {
              insertedExceptions = dbExceptions || [];
            }
          }

          // 6. Insert review if status === "requires_review"
          if (runPayload.status === "requires_review") {
            let reviewKey = "review_corte_intake_config";
            if (workflow === "xml_sat") {
              reviewKey = "review_xml_sat_validation";
            } else if (workflow === "utilities") {
              reviewKey = "review_utility_receipts";
            }

            // Find matching task or exception if possible
            const matchingTask = insertedTasks.find(t => t.task_key.includes("config") || t.task_key.includes("review"));
            const matchingException = insertedExceptions.find(e => e.exception_key.includes("discrepancy") || e.exception_key.includes("config"));

            const { error: reviewError } = await supabase
              .from("reviews")
              .insert({
                workflow_run_id: runId,
                task_id: matchingTask?.id || null,
                exception_id: matchingException?.id || null,
                review_key: reviewKey,
                status: "requested",
                metadata: {
                  workflow,
                  scenario
                }
              });

            if (reviewError) {
              console.error("Error inserting review:", reviewError);
            }
          }
        }
      } catch (dbErr) {
        console.error("Database simulation record insertion failed:", dbErr);
      }
    }

    // Clean up temp files
    for (const f of tempFiles) {
      if (existsSync(f)) unlinkSync(f);
    }

    return NextResponse.json({
      success: true,
      command,
      input: inputJson,
      config: configJson,
      result: workflowResult,
    });

  } catch (error: any) {
    // Clean up temp files
    for (const f of tempFiles) {
      if (existsSync(f)) unlinkSync(f);
    }

    return NextResponse.json(
      {
        error: error.error || "Error interno del servidor.",
        details: error.details || error.message,
        stderr: error.stderr,
        stdout: error.stdout,
      },
      { status: 500 }
    );
  }
}
