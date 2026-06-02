import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

type CookieToSet = {
  name: string;
  value: string;
  options?: Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2];
};

export type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function isConfirmed(value: string | undefined): value is string {
  return Boolean(value && value.trim() && !value.includes("[CONFIRM]"));
}

export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!isConfirmed(url) || !isConfirmed(publishableKey)) {
    return {
      configured: false as const,
      url: null,
      publishableKey: null,
      missing: [
        !isConfirmed(url) ? "NEXT_PUBLIC_SUPABASE_URL" : null,
        !isConfirmed(publishableKey) ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" : null,
      ].filter(Boolean) as string[],
    };
  }

  return {
    configured: true as const,
    url,
    publishableKey,
    missing: [],
  };
}

export async function createSupabaseServerClient() {
  const config = getSupabasePublicConfig();

  if (!config.configured) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies. Route handlers and Server Actions can.
        }
      },
    },
  });
}

export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!isConfirmed(url) || !isConfirmed(serviceRoleKey)) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
