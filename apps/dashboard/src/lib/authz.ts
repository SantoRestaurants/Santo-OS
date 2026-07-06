import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function authorizeRequest(allowedRoles: readonly string[]) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, status: 503, reason: "supabase_not_configured" };

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { ok: false as const, status: 401, reason: "auth_required" };

  let role = typeof user.app_metadata?.role === "string" ? user.app_metadata.role : null;
  if (!role && user.email) {
    const { data: person } = await supabase
      .from("people")
      .select("role_key")
      .eq("email", user.email)
      .maybeSingle();
    role = person?.role_key ?? null;
  }

  if (!role || !allowedRoles.includes(role)) {
    return { ok: false as const, status: 403, reason: "forbidden" };
  }
  return { ok: true as const, supabase, user, role };
}
