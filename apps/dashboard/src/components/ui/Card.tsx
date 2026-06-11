import type { ReactNode } from "react";

export function Card({
  title,
  eyebrow,
  action,
  children,
  className = "",
  dataTour,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  dataTour?: string;
}) {
  return (
    <section
      data-tour={dataTour}
      className={`rounded-2xl border border-stone-200 bg-white shadow-[0_10px_30px_rgba(28,25,23,0.04)] ${className}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-4">
        <div>
          {eyebrow && (
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-stone-600">
              {eyebrow}
            </p>
          )}
          <h2 className="mt-0.5 text-sm font-semibold text-stone-900">
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
