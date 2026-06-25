import "server-only";

import { createSupabaseServerClient, getSupabasePublicConfig } from "@/lib/supabase/server";

export type EventLog = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  severity: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type LogsData = {
  status: "ready" | "requires_config" | "auth_required" | "unauthorized" | "query_failed";
  missingConfig: string[];
  error: string | null;
  events: EventLog[];
};

export async function getLogsData(): Promise<LogsData> {
  const config = getSupabasePublicConfig();
  if (!config.configured) {
    return { status: "requires_config", missingConfig: config.missing, error: null, events: [] };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { status: "requires_config", missingConfig: config.missing, error: null, events: [] };
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return { status: "auth_required", missingConfig: [], error: null, events: [] };
  }

  const role = user.app_metadata?.role;
  if (role !== "supervisor") {
    const { data: person } = await supabase.from("people").select("role_key").eq("email", user.email).single();
    if (!person || person.role_key !== "supervisor") {
      return { status: "unauthorized", missingConfig: [], error: null, events: [] };
    }
  }

  const { data: events, error } = await supabase
    .from("events")
    .select("id,aggregate_type,aggregate_id,event_type,severity,payload,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return { status: "query_failed", missingConfig: [], error: error.message, events: [] };
  }

  return {
    status: "ready",
    missingConfig: [],
    error: null,
    events: events as EventLog[],
  };
}
