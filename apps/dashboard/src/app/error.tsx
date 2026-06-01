"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <section className="w-full max-w-md rounded-lg border border-red-200 bg-white p-6">
        <h1 className="text-lg font-semibold text-stone-950">No se pudo cargar el panel</h1>
        <p className="mt-2 text-sm text-stone-600">{error.message}</p>
        <button
          className="mt-5 rounded-md bg-stone-950 px-4 py-2 text-sm font-medium text-white"
          onClick={reset}
          type="button"
        >
          Reintentar
        </button>
      </section>
    </main>
  );
}
