import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createSupabaseServerClient, getSupabasePublicConfig } from "@/lib/supabase/server";

async function requestMagicLink(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  if (!email || !supabase) {
    redirect("/?auth=requires_config");
  }

  const headerStore = await headers();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    headerStore.get("origin") ||
    "http://localhost:3000";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    redirect("/?auth=requires_config");
  }

  redirect("/?auth=check_email");
}

export default function SignInPage() {
  const config = getSupabasePublicConfig();

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <section className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6">
        <p className="text-sm font-medium text-stone-500">Santo AI OS · P0</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950">Ingresar al panel</h1>
        <p className="mt-2 text-sm text-stone-600">
          Acceso por magic link de Supabase Auth. El rol operativo se lee desde app_metadata.
        </p>

        {!config.configured ? (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Faltan variables: {config.missing.join(", ")}.
          </div>
        ) : null}

        <form action={requestMagicLink} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-stone-700" htmlFor="email">
            Email
          </label>
          <input
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
            id="email"
            name="email"
            placeholder="tu@email.com"
            required
            type="email"
          />
          <button
            className="w-full rounded-md bg-stone-950 px-4 py-2 text-sm font-medium text-white disabled:bg-stone-300"
            disabled={!config.configured}
            type="submit"
          >
            Enviar magic link
          </button>
        </form>
      </section>
    </main>
  );
}
