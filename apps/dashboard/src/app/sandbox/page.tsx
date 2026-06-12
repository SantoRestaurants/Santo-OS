"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Code2,
  Database,
  FileCode,
  FileText,
  FolderOpen,
  HelpCircle,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  XCircle,
  Globe,
  Settings,
  ArrowDownCircle,
  Shield,
  Layers,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Metric } from "@/components/ui/Metric";

type WorkflowType = "corte_santo" | "xml_sat" | "utilities";

interface Scenario {
  id: string;
  name: string;
  description: string;
  expectedResult: string;
  type: "success" | "warning" | "error";
}

const WORKFLOWS: { id: WorkflowType; name: string; description: string; icon: any }[] = [
  {
    id: "corte_santo",
    name: "Corte Santo",
    description: "Reconciliación de caja diaria contra depósitos y reportes.",
    icon: FileText,
  },
  {
    id: "xml_sat",
    name: "Validación XML SAT",
    description: "Extracción y validación local de CFDI fiscales contra listas permitidas.",
    icon: ShieldCheck,
  },
  {
    id: "utilities",
    name: "Recibos de Servicios",
    description: "Clasificación y registro de recibos de luz, agua y gas.",
    icon: Database,
  },
];

const SCENARIOS: Record<WorkflowType, Scenario[]> = {
  corte_santo: [
    {
      id: "scenario_1_ok",
      name: "01. Corte que cuadra",
      description: "El cierre de terminales/plataformas coincide exactamente con el cierre del sistema (Wansoft) en todas las formas de pago.",
      expectedResult: "Estatus: ready_for_approval (Total Real = Total Sistema, sin excepciones).",
      type: "success",
    },
    {
      id: "scenario_2_cash_discrepancy",
      name: "02. Diferencia en Efectivo",
      description: "El efectivo del cierre real no coincide con el del sistema. Con tolerancia $0, cualquier diferencia genera excepción.",
      expectedResult: "Estatus: requires_review. Excepción por diferencia en la forma de pago Efectivo.",
      type: "warning",
    },
    {
      id: "scenario_3_high_deposit_discrepancy",
      name: "03. Diferencia en Bancos",
      description: "El monto de Bancos (Banorte débito/crédito) del cierre real difiere del sistema. Con tolerancia $0 se marca de inmediato.",
      expectedResult: "Estatus: requires_review. Excepción por diferencia en Bancos y en el Total Real vs Sistema.",
      type: "error",
    },
    {
      id: "scenario_4_missing_documents",
      name: "04. Faltan documentos del corte",
      description: "Falta algún adjunto obligatorio del corte (Excel del corte o reporte global de Wansoft).",
      expectedResult: "Estatus: requires_review. Excepción por falta de documentos obligatorios.",
      type: "error",
    },
    {
      id: "scenario_5_from_excel",
      name: "05. Lectura automática del Excel",
      description: "El sistema lee las cifras de Cierre Ter/Pla y Cierre Sistema directamente del Excel del corte y reconcilia.",
      expectedResult: "Estatus: ready_for_approval. Cifras extraídas del Excel y conciliadas.",
      type: "success",
    },
  ],
  xml_sat: [
    {
      id: "scenario_1_ok",
      name: "01. Factura Válida",
      description: "El XML se parsea correctamente y los RFCs (emisor y receptor) están en la lista permitida.",
      expectedResult: "Estatus: validated. Metadata extraída y lista para guardar en Drive.",
      type: "success",
    },
    {
      id: "scenario_2_rfc_mismatch",
      name: "02. RFC no Permitido",
      description: "El emisor del XML no está registrado en la lista de proveedores autorizados.",
      expectedResult: "Estatus: requires_review. Excepción por RFC no mapeado/desconocido.",
      type: "warning",
    },
    {
      id: "scenario_3_malicious_xml",
      name: "03. XML Inseguro (DOCTYPE)",
      description: "El archivo contiene una declaración DOCTYPE no permitida, que simula un ataque XXE.",
      expectedResult: "Estatus: requires_review. Excepción crítica por XML parse error (seguridad).",
      type: "error",
    },
  ],
  utilities: [
    {
      id: "scenario_1_ok",
      name: "01. Recibo CFE Válido",
      description: "Recibo de luz de CFE con monto, fecha de vencimiento y número de servicio válido.",
      expectedResult: "Estatus: registered. Registra la tarea y prepara la evidencia para Drive.",
      type: "success",
    },
    {
      id: "scenario_2_invalid_provider",
      name: "02. Proveedor No Soportado",
      description: "Se ingresa un recibo de Internet (Telmex), el cual no está soportado en P0.",
      expectedResult: "Estatus: requires_review. Excepción por proveedor de servicio no configurado.",
      type: "warning",
    },
    {
      id: "scenario_3_missing_fields",
      name: "03. Falta Número de Servicio",
      description: "Se ingresa un recibo de agua sin el número de servicio obligatorio.",
      expectedResult: "Estatus: requires_review. Excepción por datos obligatorios faltantes.",
      type: "error",
    },
  ],
};

interface WorkflowStepExplanation {
  title: string;
  desc: string;
  detail: string;
}

const WORKFLOW_EXPLANATIONS: Record<WorkflowType, WorkflowStepExplanation[]> = {
  corte_santo: [
    {
      title: "1. Intake / Recepción",
      desc: "Recepción del corte: Excel del corte, reporte global de Wansoft y comprobantes de terminales.",
      detail: "Valida la estructura del envío y detecta si los adjuntos obligatorios están incluidos.",
    },
    {
      title: "2. Verificación de Configuración",
      desc: "Cruza el identificador de la unidad y las formas de pago y tolerancia cargadas en base de datos.",
      detail: "Si la unidad, las formas de pago o la tolerancia no están confirmadas, el workflow se detiene y pasa a revisión manual.",
    },
    {
      title: "3. Lectura del Excel (automática)",
      desc: "Extrae del Excel del corte las cifras de Cierre Ter/Pla y Cierre Sistema por forma de pago.",
      detail: "Si encuentra una columna que no puede mapear con seguridad, no inventa: deja la corrida en revisión.",
    },
    {
      title: "4. Reconciliación por forma de pago",
      desc: "Compara, forma por forma, el cierre real (terminales/plataformas) contra el del sistema (Wansoft).",
      detail: "Con tolerancia $0, cualquier diferencia por grupo (Amex, Bancos, Efectivo, Transferencia, Plataformas) gatilla una excepción.",
    },
    {
      title: "5. Total Real vs Total Sistema",
      desc: "Verifica que el Total Real sea idéntico al Total Sistema.",
      detail: "Si no coinciden, se marca la corrida como requires_review para que una persona investigue el origen.",
    },
    {
      title: "6. Reporte REVISION y evidencia",
      desc: "Arma el reporte REVISION en el formato del cliente y prepara la subida a Google Drive.",
      detail: "Si todo cuadra, el estado es ready_for_approval para la aprobación final; si no, queda en requires_review.",
    },
  ],
  xml_sat: [
    {
      title: "1. Recepción y Sanitización XML",
      desc: "Sanitiza el texto XML y descarta inyecciones de seguridad XML (XXE).",
      detail: "Bloquea de raíz cualquier archivo que declare elementos DOCTYPE o ENTITY externos para proteger al servidor."
    },
    {
      title: "2. Parseo de Comprobante CFDI v4.0",
      desc: "Extrae de forma local el UUID timbrado, fecha de emisión, emisor, receptor y total de la factura.",
      detail: "Utiliza el analizador local de Python ElementTree sin consumir servicios externos o gubernamentales lentos."
    },
    {
      title: "3. Verificación de RFCs (Lista Blanca)",
      desc: "Verifica que el RFC emisor y receptor estén en la base de datos de RFCs autorizados.",
      detail: "Si los RFCs no pertenecen a la lista permitida configurada por el equipo, el comprobante se marca en revisión."
    },
    {
      title: "4. Estatus y Subida",
      desc: "Clasifica el resultado en Supabase y mueve el XML procesado a su carpeta de Drive correspondiente.",
      detail: "Crea la tarea de validación y la excepción fiscal si el emisor no está registrado."
    }
  ],
  utilities: [
    {
      title: "1. Intake del Recibo de Servicio",
      desc: "Clasifica el proveedor (CFE, agua o gas), monto a pagar y fecha límite de pago.",
      detail: "Mapea los recibos a las variables operativas requeridas para evitar dobles pagos o recargos."
    },
    {
      title: "2. Verificación de Número de Servicio",
      desc: "Cruza el número de servicio extraído del recibo contra el catálogo de servicios de Santo.",
      detail: "Valida que el número de servicio coincida con el patrón regex configurado (ej: 12 dígitos para CFE)."
    },
    {
      title: "3. Asignación de Responsable y Ruta",
      desc: "Mapea el recibo a la persona responsable de pagos y determina la carpeta de Google Drive según el tipo de servicio.",
      detail: "Mantiene la trazabilidad del proceso en Supabase vinculando el recibo al flujo de aprobación de cuentas por pagar."
    }
  ]
};

export default function SandboxPage() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowType>("corte_santo");
  const [selectedScenario, setSelectedScenario] = useState<string>("scenario_1_ok");
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"visual" | "payload" | "output" | "terminal">("visual");
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Google Drive connection settings
  const [driveEnabled, setDriveEnabled] = useState(false);
  const [driveFolderId, setDriveFolderId] = useState("1sN9QP54zdwgprH0-LUJwCVLtd4OY9vsL");
  const [driveAccessToken, setDriveAccessToken] = useState("");

  const activeScenarios = SCENARIOS[selectedWorkflow];
  const activeScenarioObj = activeScenarios.find((s) => s.id === selectedScenario) || activeScenarios[0];

  const handleWorkflowChange = (wf: WorkflowType) => {
    setSelectedWorkflow(wf);
    const newScenarios = SCENARIOS[wf];
    setSelectedScenario(newScenarios[0].id);
    setExecutionResult(null);
    setErrorMsg(null);
  };

  const handleRun = async () => {
    setRunning(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/sandbox/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow: selectedWorkflow,
          scenario: selectedScenario,
          driveSettings: {
            enabled: driveEnabled,
            folderId: driveFolderId.trim(),
            accessToken: driveAccessToken.trim(),
          }
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.details || "Error en la ejecución.");
      }
      setExecutionResult(data);
    } catch (e: any) {
      setErrorMsg(e.message);
      setActiveTab("terminal");
    } finally {
      setRunning(false);
    }
  };

  const getLocalMockFile = (name: string, type: string) => {
    let mockName = name.toLowerCase();
    if (mockName.includes("corte-santo") || type === "daily_sales_report") {
      return "/fixtures/corte-santo-2026-06-08.pdf";
    }
    if (mockName.includes("deposito") || mockName.includes("banorte")) {
      return "/fixtures/deposito-banorte-2026-06-08.csv";
    }
    if (mockName.includes("cfe") || mockName.includes("recibo") || type === "utility_receipt") {
      return "/fixtures/recibo-cfe-junio.pdf";
    }
    if (mockName.includes("cfdi") || mockName.endsWith(".xml") || type === "xml_sat") {
      return "/fixtures/cfdi-proveedor-demo.xml";
    }
    return "/fixtures/corte-santo-2026-06-08.pdf";
  };

  return (
    <div className="min-h-screen bg-stone-50 pb-12 pt-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white px-6 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-stone-950 p-2 text-white">
              <Terminal className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-stone-900">Consola de Simulación (Sandbox)</h1>
              <p className="text-xs text-stone-600">
                Ejecuta el código real de Python en tu máquina, visualiza las respuestas en vivo y sube evidencia a Google Drive.
              </p>
            </div>
          </div>
          <Badge tone="blue">Entorno de Pruebas P0</Badge>
        </header>

        <div className="grid gap-6 lg:grid-cols-[330px_1fr]">
          {/* Configuration Panel */}
          <div className="flex flex-col gap-5">
            <Card title="1. Selecciona Workflow" eyebrow="Procesos disponibles">
              <div className="space-y-2">
                {WORKFLOWS.map((wf) => {
                  const Icon = wf.icon;
                  const isSelected = selectedWorkflow === wf.id;
                  return (
                    <button
                      key={wf.id}
                      onClick={() => handleWorkflowChange(wf.id)}
                      className={`flex w-full items-start gap-3 rounded-xl p-3 text-left transition ${isSelected
                        ? "bg-stone-950 text-white shadow-md"
                        : "bg-white text-stone-700 border border-stone-200 hover:bg-stone-50"
                        }`}
                      type="button"
                    >
                      <Icon className={`mt-0.5 h-4 w-4 ${isSelected ? "text-emerald-400" : "text-stone-600"}`} />
                      <div>
                        <p className="text-xs font-semibold">{wf.name}</p>
                        <p className={`mt-1 text-[10px] leading-4 ${isSelected ? "text-stone-300" : "text-stone-600"}`}>
                          {wf.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card title="2. Escenario de Prueba" eyebrow="Variantes de entrada">
              <div className="space-y-2">
                {activeScenarios.map((sc) => {
                  const isSelected = selectedScenario === sc.id;
                  let dotColor = "bg-stone-400";
                  if (sc.type === "success") dotColor = "bg-emerald-500";
                  if (sc.type === "warning") dotColor = "bg-amber-500";
                  if (sc.type === "error") dotColor = "bg-rose-500";

                  return (
                    <button
                      key={sc.id}
                      onClick={() => {
                        setSelectedScenario(sc.id);
                        setExecutionResult(null);
                        setErrorMsg(null);
                      }}
                      className={`flex w-full flex-col rounded-xl border p-3 text-left transition ${isSelected
                        ? "border-stone-950 bg-stone-50/80 shadow-sm"
                        : "border-stone-200 bg-white hover:bg-stone-50/50"
                        }`}
                      type="button"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                        <p className="text-xs font-semibold text-stone-900">{sc.name}</p>
                      </div>
                      <p className="mt-1.5 text-[10px] leading-4 text-stone-600">{sc.description}</p>
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Google Drive Connection Settings */}
            <Card title="3. Google Drive (Conexión Real)" eyebrow="Destino configurable">
              <div className="space-y-3">
                <label className="flex items-center gap-2 rounded-xl border border-stone-200 p-2.5 hover:bg-stone-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={driveEnabled}
                    onChange={(e) => setDriveEnabled(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                  />
                  <span className="text-xs font-medium text-stone-700">Subir a Google Drive Real</span>
                </label>

                {driveEnabled && (
                  <div className="space-y-3 pt-1 border-t border-stone-100">
                    <div>
                      <label className="block text-[10px] font-bold text-stone-600 uppercase tracking-wider mb-1">
                        ID de Carpeta en Google Drive
                      </label>
                      <input
                        type="text"
                        value={driveFolderId}
                        onChange={(e) => setDriveFolderId(e.target.value)}
                        placeholder="Ej: 1A2B3C4D5E6F7G8H..."
                        className="w-full rounded-xl border border-stone-200 bg-stone-50 p-2 text-xs font-mono text-stone-800 focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
                      />
                      <p className="mt-1 text-[9px] text-stone-600">
                        Copia la parte final de la URL de tu carpeta de Drive.
                      </p>
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-[10px] font-bold text-stone-600 uppercase tracking-wider">
                          Access Token (OAuth 2.0)
                        </label>
                        <a
                          href="https://developers.google.com/oauthplayground/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[9px] text-emerald-600 hover:underline"
                        >
                          Generar Token ↗
                        </a>
                      </div>
                      <input
                        type="password"
                        value={driveAccessToken}
                        onChange={(e) => setDriveAccessToken(e.target.value)}
                        placeholder="Ej: ya29.a0AfB_..."
                        className="w-full rounded-xl border border-stone-200 bg-stone-50 p-2 text-xs font-mono text-stone-800 focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
                      />
                      <p className="mt-1 text-[9px] text-stone-600">
                        Se requiere scope: <code>drive.file</code> o <code>drive</code>.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {/* Run Button */}
            <button
              onClick={handleRun}
              disabled={running}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-semibold text-white shadow-md transition hover:bg-emerald-700 disabled:bg-emerald-400"
              type="button"
            >
              {running ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Ejecutando en Python...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" />
                  Ejecutar Workflow
                </>
              )}
            </button>
          </div>

          {/* Results Panel */}
          <div className="flex flex-col">
            {/* Tabs */}
            <div className="flex border-b border-stone-200 bg-white px-4 pt-2 rounded-t-2xl border-t border-x border-stone-200">
              {(["visual", "payload", "output", "terminal"] as const).map((tab) => {
                const labels = {
                  visual: "Visualización",
                  payload: "Input (JSON)",
                  output: "Output (JSON)",
                  terminal: "Terminal / Consola",
                };
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`border-b-2 px-4 py-2.5 text-xs font-semibold transition ${isActive
                      ? "border-stone-950 text-stone-950"
                      : "border-transparent text-stone-500 hover:text-stone-700"
                      }`}
                    type="button"
                  >
                    {labels[tab]}
                  </button>
                );
              })}
            </div>

            {/* Content Box */}
            <div className="min-h-[500px] flex-1 rounded-b-2xl border-b border-x border-stone-200 bg-white p-6 shadow-sm">
              {errorMsg && (
                <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <div className="flex gap-3">
                    <XCircle className="h-5 w-5 text-rose-600" />
                    <div>
                      <p className="text-xs font-semibold text-rose-900">Error en la ejecución del Script</p>
                      <p className="mt-1 text-xs text-rose-800">{errorMsg}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Explaining Workflow section (always visible above or when not executed) */}
              <div className="mb-6 rounded-2xl border border-stone-200 bg-stone-50 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="rounded-lg bg-stone-900 p-1.5 text-white">
                    <Layers className="h-3.5 w-3.5" />
                  </span>
                  <h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                    ¿Qué hace este Workflow de Python por dentro?
                  </h3>
                </div>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {WORKFLOW_EXPLANATIONS[selectedWorkflow].map((step, i) => (
                    <div key={i} className="rounded-xl border border-white bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.015)]">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase">{step.title}</p>
                      <p className="mt-1 text-xs font-semibold text-stone-900 leading-5">{step.desc}</p>
                      <p className="mt-1 text-[10px] text-stone-600 leading-4">{step.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              {!executionResult && !running && (
                <div className="flex h-64 flex-col items-center justify-center text-center">
                  <Server className="h-10 w-10 text-stone-300" />
                  <h3 className="mt-4 text-xs font-semibold text-stone-900">Listo para simular</h3>
                  <p className="mt-1 max-w-sm text-xs text-stone-600">
                    Presiona el botón de la izquierda para correr el script. El Sandbox cargará la configuración y el archivo de entrada correspondiente.
                  </p>
                  <div className="mt-4 text-left rounded-xl bg-stone-50 border border-stone-200 p-3 max-w-md">
                    <p className="text-[10px] font-mono text-stone-700">
                      <strong>Comportamiento esperado:</strong>
                      <br />
                      {activeScenarioObj.expectedResult}
                    </p>
                  </div>
                </div>
              )}

              {running && (
                <div className="flex h-64 flex-col items-center justify-center">
                  <RefreshCw className="h-8 w-8 animate-spin text-emerald-600" />
                  <p className="mt-4 text-xs font-medium text-stone-700">Corriendo script de Python...</p>
                  <p className="mt-1 text-[10px] text-stone-600">Validando reglas, firmas digitales e integridad de datos.</p>
                </div>
              )}

              {executionResult && !running && (
                <>
                  {activeTab === "visual" && (
                    <div className="space-y-6">
                      {/* Summary Banner */}
                      <div
                        className={`rounded-2xl border p-5 flex items-start gap-4 ${executionResult.result.status === "requires_review"
                          ? "bg-amber-50/70 border-amber-200"
                          : "bg-emerald-50/70 border-emerald-200"
                          }`}
                      >
                        {executionResult.result.status === "requires_review" ? (
                          <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="flex items-center gap-3">
                            <h3 className="text-sm font-bold text-stone-900">
                              Resultado del Script:{" "}
                              {executionResult.result.status === "requires_review"
                                ? "Requiere Revisión Humana"
                                : "Completado / Validado"}
                            </h3>
                            <Badge tone={executionResult.result.status === "requires_review" ? "amber" : "green"}>
                              {executionResult.result.status}
                            </Badge>
                          </div>
                          <p className="mt-1.5 text-xs leading-5 text-stone-600">
                            {executionResult.result.status === "requires_review"
                              ? `El script finalizó con un estado pendiente de aprobación debido a: ${executionResult.result.workflow_run.requires_review_reason ||
                              "excepciones de descuadre en los datos"
                              }.`
                              : "El script se ejecutó sin detectar discrepancias críticas o configuraciones faltantes."}
                          </p>
                        </div>
                      </div>

                      {/* Info grid */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-600">Detalles de Ejecución</p>
                          <div className="mt-3 space-y-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-stone-600">Workflow Key:</span>
                              <span className="font-mono text-stone-800">{executionResult.result.workflow_key}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-stone-600">Idempotency Key:</span>
                              <span className="font-mono text-stone-600 truncate max-w-[180px]" title={executionResult.result.idempotency_key}>
                                {executionResult.result.idempotency_key}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-stone-600">Google Drive:</span>
                              <span className="font-semibold text-stone-700">
                                {driveEnabled ? "Conectado (Real)" : "Simulado (Dry Run)"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-600">Evidencia del Script</p>
                          <div className="mt-3 space-y-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-stone-600">Documentos Leídos:</span>
                              <span className="font-semibold text-stone-800">{executionResult.result.documents.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-stone-600">Tareas Creadas:</span>
                              <span className="font-semibold text-stone-800">{executionResult.result.tasks.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-stone-600">Excepciones Gatilladas:</span>
                              <span className="font-semibold text-stone-800">{executionResult.result.exceptions.length}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Exceptions list */}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600 mb-3">Excepciones ({executionResult.result.exceptions.length})</h4>
                        {executionResult.result.exceptions.length === 0 ? (
                          <div className="rounded-xl border border-stone-100 bg-stone-50/50 p-4 text-center text-xs text-stone-600">
                            No se generaron excepciones en esta ejecución.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {executionResult.result.exceptions.map((exc: any, i: number) => (
                              <div key={i} className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 flex gap-3">
                                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="text-xs font-semibold text-stone-900">{exc.exception_key}</p>
                                    <Badge tone="amber">{exc.severity}</Badge>
                                  </div>
                                  <p className="mt-1 text-xs text-stone-600">
                                    Tipo: <span className="font-mono">{exc.exception_type}</span>
                                  </p>
                                  <div className="mt-2 rounded-lg bg-white p-2.5 text-[10px] font-mono border border-amber-100 text-stone-800">
                                    {JSON.stringify(exc.details, null, 2)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Documents / Uploaded files */}
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600">
                            Archivos Subidos / Evidencia ({executionResult.result.documents.length})
                          </h4>
                          <span className="text-[10px] text-stone-600 italic">Haz click en los archivos para abrirlos y validarlos</span>
                        </div>
                        <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden bg-white">
                          {executionResult.result.documents.map((doc: any, i: number) => {
                            const isReal = doc.metadata?.is_real_drive_upload;
                            const fileLink = isReal ? doc.source_uri : getLocalMockFile(doc.metadata?.original_filename || doc.document_key, doc.document_type);

                            return (
                              <div key={i} className="flex items-center justify-between p-3.5 text-xs hover:bg-stone-50">
                                <div className="flex items-center gap-3">
                                  <FolderOpen className="h-4 w-4 text-stone-500" />
                                  <div>
                                    <a
                                      href={fileLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-semibold text-stone-900 hover:text-emerald-600 hover:underline flex items-center gap-1.5"
                                    >
                                      {doc.metadata?.original_filename || doc.document_key}
                                      <span className="text-[9px] text-stone-500 font-normal">
                                        {isReal ? "(Google Drive ↗)" : "(Vista Previa ↗)"}
                                      </span>
                                    </a>
                                    <p className="mt-0.5 text-[10px] text-stone-600">
                                      {isReal
                                        ? `Subido a Google Drive carpeta ID: ${driveFolderId}`
                                        : `Ruta propuesta en Drive: drive-folder-santo`}
                                    </p>
                                  </div>
                                </div>
                                <Badge tone={doc.status === "registered" || doc.status === "validated" ? "green" : "amber"}>
                                  {isReal ? "Subido a Drive" : "Preparado (Demo)"}
                                </Badge>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Tasks list */}
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600 mb-3">Tareas Registradas ({executionResult.result.tasks.length})</h4>
                        <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl overflow-hidden bg-white">
                          {executionResult.result.tasks.map((task: any, i: number) => (
                            <div key={i} className="flex items-center justify-between p-3.5 text-xs hover:bg-stone-50">
                              <div>
                                <p className="font-semibold text-stone-900">{task.title}</p>
                                <p className="mt-1 text-[10px] font-mono text-stone-600">{task.task_key}</p>
                              </div>
                              <Badge tone={task.status === "completed" ? "green" : "amber"}>
                                {task.status === "completed" ? "Completada" : "Pendiente"}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === "payload" && (
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2 flex items-center gap-2">
                          <FileCode className="h-4 w-4" /> JSON de Entrada (Payload)
                        </h4>
                        <pre className="overflow-auto rounded-xl border border-stone-200 bg-stone-950 p-4 text-[11px] font-mono text-stone-300 max-h-[300px]">
                          {JSON.stringify(executionResult.input, null, 2)}
                        </pre>
                      </div>

                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2 flex items-center gap-2">
                          <Code2 className="h-4 w-4" /> Configuración (Config Confirmado)
                        </h4>
                        <pre className="overflow-auto rounded-xl border border-stone-200 bg-stone-950 p-4 text-[11px] font-mono text-stone-300 max-h-[300px]">
                          {JSON.stringify(executionResult.config, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {activeTab === "output" && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">JSON de Salida (Output)</h4>
                      <pre className="overflow-auto rounded-xl border border-stone-200 bg-stone-950 p-4 text-[11px] font-mono text-emerald-400 max-h-[550px]">
                        {JSON.stringify(executionResult.result, null, 2)}
                      </pre>
                    </div>
                  )}

                  {activeTab === "terminal" && (
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">Comando Ejecutado</h4>
                        <pre className="overflow-auto rounded-xl border border-stone-200 bg-stone-950 px-4 py-3 text-xs font-mono text-white">
                          {executionResult.command}
                        </pre>
                      </div>

                      {executionResult.stderr && (
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-rose-500 mb-2">Errores de Consola (stderr)</h4>
                          <pre className="overflow-auto rounded-xl border border-rose-200 bg-rose-950 p-4 text-[11px] font-mono text-rose-300 max-h-[200px]">
                            {executionResult.stderr}
                          </pre>
                        </div>
                      )}

                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-stone-600 mb-2">Salida Estándar de Python (stdout)</h4>
                        <pre className="overflow-auto rounded-xl border border-stone-200 bg-stone-900 p-4 text-[11px] font-mono text-stone-200 max-h-[350px]">
                          {executionResult.stdout || JSON.stringify(executionResult.result, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
