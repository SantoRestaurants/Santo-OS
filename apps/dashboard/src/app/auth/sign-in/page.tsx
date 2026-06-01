import { redirect } from "next/navigation";

import { createSupabaseServerClient, getSupabasePublicConfig } from "@/lib/supabase/server";

async function signInWithPassword(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const supabase = await createSupabaseServerClient();

  if (!email || !password || !supabase) {
    redirect("/auth/sign-in?error=missing_fields");
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/auth/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/");
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const errorMessage = typeof params.error === "string" ? params.error : null;
  const config = getSupabasePublicConfig();

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <section className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6">
        <p className="text-sm font-medium text-stone-500">Santo AI OS · P0</p>
        <h1 className="mt-2 text-2xl font-semibold text-stone-950">Ingresar al panel</h1>
        <p className="mt-2 text-sm text-stone-600">
          Acceso con email y contraseña. El rol operativo se lee desde app_metadata.
        </p>

        {!config.configured ? (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Faltan variables: {config.missing.join(", ")}.
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMessage}
          </div>
        ) : null}

        <form action={signInWithPassword} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700" htmlFor="email">
              Email
            </label>
            <input
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
              id="email"
              name="email"
              placeholder="tu@email.com"
              required
              type="email"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700" htmlFor="password">
              Contraseña
            </label>
            <input
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
              id="password"
              name="password"
              placeholder="••••••••"
              required
              type="password"
            />
          </div>
          <button
            className="w-full rounded-md bg-stone-950 px-4 py-2 text-sm font-medium text-white disabled:bg-stone-300"
            disabled={!config.configured}
            type="submit"
          >
            Ingresar
          </button>
        </form>
      </section>
    </main>
  );
}
