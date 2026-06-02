import "server-only";

import { createSupabaseServerClient, getSupabasePublicConfig } from "@/lib/supabase/server";

export type DashboardStatus = "ready" | "demo" | "requires_config" | "auth_required" | "query_failed";

type RunRow = {
  id: string;
  status: string;
  business_date: string | null;
  source_channel: string;
  requires_review_reason: string | null;
  created_at: string;
};

type ExceptionRow = {
  id: string;
  exception_type: string;
  severity: string;
  status: string;
  created_at: string;
};

type ReviewRow = {
  id: string;
  review_key: string;
  status: string;
  requested_at: string;
};

type EmailMessageRow = {
  id: string;
  from_address: string;
  subject: string | null;
  processing_status: string;
  received_at: string;
};

type DemoFlowStep = {
  key: string;
  label: string;
  status: string;
  detail: string;
};

export type DashboardData = {
  status: DashboardStatus;
  missingConfig: string[];
  userEmail: string | null;
  role: string;
  error: string | null;
  runs: RunRow[];
  exceptions: ExceptionRow[];
  reviews: ReviewRow[];
  emailMessages: EmailMessageRow[];
  demoFlow: DemoFlowStep[];
};

const EMPTY_DATA = {
  runs: [] as RunRow[],
  exceptions: [] as ExceptionRow[],
  reviews: [] as ReviewRow[],
  emailMessages: [] as EmailMessageRow[],
  demoFlow: [] as DemoFlowStep[],
};

const DEMO_DATA: DashboardData = {
  status: "demo",
  missingConfig: [],
  userEmail: "demo@santo.com",
  role: "admin_demo",
  error: null,
  runs: [
    {
      id: "demo-run-corte-2026-06-02",
      status: "requires_review",
      business_date: "2026-06-02",
      source_channel: "agent_mail",
      requires_review_reason:
        "thresholds, reviewer_map and drive_folder_map are pending Santo confirmation",
      created_at: "2026-06-02T09:15:00.000Z",
    },
    {
      id: "demo-run-xml-2026-06",
      status: "requires_review",
      business_date: "2026-06-01",
      source_channel: "dashboard",
      requires_review_reason: "real sanitized MiAdminXML fixture is pending",
      created_at: "2026-06-02T08:40:00.000Z",
    },
  ],
  exceptions: [
    {
      id: "demo-exception-corte-config",
      exception_type: "missing_corte_operational_config",
      severity: "medium",
      status: "requires_review",
      created_at: "2026-06-02T09:15:00.000Z",
    },
    {
      id: "demo-exception-document-hash",
      exception_type: "document_requires_review",
      severity: "medium",
      status: "requires_review",
      created_at: "2026-06-02T09:15:00.000Z",
    },
  ],
  reviews: [
    {
      id: "demo-review-corte-intake",
      review_key: "review_corte_intake_config",
      status: "requires_review",
      requested_at: "2026-06-02T09:16:00.000Z",
    },
    {
      id: "demo-review-agent-mail-routing",
      review_key: "confirm_agent_mail_routing",
      status: "requires_review",
      requested_at: "2026-06-02T09:18:00.000Z",
    },
  ],
  emailMessages: [
    {
      id: "demo-email-corte",
      from_address: "gerencia-demo@santo.com",
      subject: "[CORTE] Corte Santo 2026-06-02 - unidad demo",
      processing_status: "classified",
      received_at: "2026-06-02T09:14:00.000Z",
    },
    {
      id: "demo-email-ambiguous",
      from_address: "proveedor-demo@example.com",
      subject: "facturas varias",
      processing_status: "requires_review",
      received_at: "2026-06-02T09:20:00.000Z",
    },
  ],
  demoFlow: [
    {
      key: "input",
      label: "Input",
      status: "demo",
      detail: "Un correo falso con asunto [CORTE] entra como ejemplo. Agent Mail real aun no esta conectado.",
    },
    {
      key: "workflow_run",
      label: "Workflow run",
      status: "requires_review",
      detail: "El sistema propone un run de Corte Santo para una fecha y unidad demo.",
    },
    {
      key: "documents_tasks",
      label: "Docs + tareas",
      status: "requires_review",
      detail: "Registra documentos y tareas de revision, pero deja flags porque faltan reglas reales.",
    },
    {
      key: "exceptions",
      label: "Exceptions",
      status: "requires_review",
      detail: "Thresholds, reviewers y Drive pendientes se convierten en excepciones revisables.",
    },
    {
      key: "events_watchdog",
      label: "Events + watchdog",
      status: "logged",
      detail: "Deja auditoria y watchdog. No pasa silenciosamente como completed.",
    },
    {
      key: "dashboard",
      label: "Dashboard",
      status: "visible",
      detail: "Muestra que paso, que falta y que necesita revision humana.",
    },
  ],
};

export async function getDashboardData(options: { demo?: boolean } = {}): Promise<DashboardData> {
  if (options.demo) {
    return DEMO_DATA;
  }

  const config = getSupabasePublicConfig();

  if (!config.configured) {
    return {
      status: "requires_config",
      missingConfig: config.missing,
      userEmail: null,
      role: "requires_config",
      error: null,
      ...EMPTY_DATA,
    };
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      status: "requires_config",
      missingConfig: config.missing,
      userEmail: null,
      role: "requires_config",
      error: null,
      ...EMPTY_DATA,
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      status: "auth_required",
      missingConfig: [],
      userEmail: null,
      role: "unauthenticated",
      error: userError?.message ?? null,
      ...EMPTY_DATA,
    };
  }

  const role = String(user.app_metadata?.santo_role ?? user.app_metadata?.role ?? "staff");

  const [runsResult, exceptionsResult, reviewsResult, emailMessagesResult] = await Promise.all([
    supabase
      .from("workflow_runs")
      .select("id,status,business_date,source_channel,requires_review_reason,created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("exceptions")
      .select("id,exception_type,severity,status,created_at")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("reviews")
      .select("id,review_key,status,requested_at")
      .order("requested_at", { ascending: false })
      .limit(8),
    supabase
      .from("email_messages")
      .select("id,from_address,subject,processing_status,received_at")
      .order("received_at", { ascending: false })
      .limit(8),
  ]);

  const firstError =
    runsResult.error ||
    exceptionsResult.error ||
    reviewsResult.error ||
    emailMessagesResult.error;

  if (firstError) {
    return {
      status: "query_failed",
      missingConfig: [],
      userEmail: user.email ?? null,
      role,
      error: firstError.message,
      ...EMPTY_DATA,
    };
  }

  return {
    status: "ready",
    missingConfig: [],
    userEmail: user.email ?? null,
    role,
    error: null,
    runs: runsResult.data ?? [],
    exceptions: exceptionsResult.data ?? [],
    reviews: reviewsResult.data ?? [],
    emailMessages: emailMessagesResult.data ?? [],
    demoFlow: [],
  };
}
