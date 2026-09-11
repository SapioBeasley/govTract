"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function UnderstandingActionButton({
  opportunityId,
  hasUnderstanding,
}: {
  opportunityId: string;
  hasUnderstanding: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generate() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/understanding`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: hasUnderstanding ? "regenerate" : "generate" }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        setMessage(payload?.error?.message ?? "Solicitation understanding could not be generated.");
        return;
      }
      setMessage(hasUnderstanding ? "Understanding regenerated." : "Understanding generated.");
      router.refresh();
    } catch {
      setMessage("Solicitation understanding could not be generated.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <button
        type="button"
        onClick={generate}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <RefreshCw className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        {pending
          ? "Generating…"
          : hasUnderstanding
            ? "Regenerate understanding"
            : "Generate understanding"}
      </button>
      {message ? (
        <p className="max-w-full break-words text-xs text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
