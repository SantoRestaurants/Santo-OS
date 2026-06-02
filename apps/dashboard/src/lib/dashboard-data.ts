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
};

const EMPTY_DATA = {
  runs: [] as RunRow[],
  exceptions: [] as ExceptionRow[],
  reviews: [] as ReviewRow[],
  emailMessages: [] as EmailMessageRow[],
};

const DEMO_DATA: DashboardData = {
  status: "demo",
  missingConfig: [],
  userEmail: null,
  role: "demo",
  error: null,
  runs: [],
  exceptions: [],
  reviews: [],
  emailMessages: [],
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

  const role = String(user.app_metadata?.operational_role ?? user.app_metadata?.role ?? "staff");

  const [runsResult, exceptionsResult, reviewsResult, emailMessagesResult] = await Promise.all([
    supabase
      .from("workflow_runs")
      .select("id,status,business_date,source_channel,requires_review_reason,created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("exceptions")
      .select("id,exception_type,severity,status,created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("reviews")
      .select("id,review_key,status,requested_at")
      .order("requested_at", { ascending: false })
      .limit(10),
    supabase
      .from("email_messages")
      .select("id,from_address,subject,processing_status,received_at")
      .order("received_at", { ascending: false })
      .limit(10),
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
  };
}
