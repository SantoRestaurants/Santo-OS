export default function Loading() {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <div className="h-24 rounded-lg border border-stone-200 bg-white" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 rounded-lg border border-stone-200 bg-white" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <div className="h-80 rounded-lg border border-stone-200 bg-white" />
          <div className="h-80 rounded-lg border border-stone-200 bg-white" />
        </div>
      </div>
    </main>
  );
}
