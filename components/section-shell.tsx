import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function SectionShell({
  eyebrow,
  title,
  description,
  icon: Icon,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  children?: ReactNode;
}) {
  return (
    <div className="min-h-screen px-6 py-8 md:px-10 md:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-start justify-between gap-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              {eyebrow}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)] md:text-base">
              {description}
            </p>
          </div>
          <div className="hidden size-11 place-items-center rounded-xl border bg-white md:grid">
            <Icon className="size-5" />
          </div>
        </div>

        {children ?? (
          <div className="rounded-2xl border bg-white p-8 shadow-sm">
            <div className="rounded-xl border border-dashed bg-[var(--muted)]/50 p-10 text-center">
              <p className="font-medium">Application shell ready</p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">
                This route is intentionally a foundation placeholder. Product data and workflows arrive in the next implementation issues.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
