"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ApiPayload = {
  workspace?: { id: string };
  error?: { message?: string };
};

export function StartBidButton({
  opportunityId,
  workspaceId,
}: {
  opportunityId: string;
  workspaceId: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (workspaceId) {
    return (
      <Link
        href={`/bids/${workspaceId}`}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90"
      >
        Continue bid <ArrowRight className="size-4" />
      </Link>
    );
  }

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/bid-workspace`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;
      if (!response.ok || !payload?.workspace?.id) {
        setError(payload?.error?.message ?? "Bid workspace could not be started.");
        return;
      }
      router.push(`/bids/${payload.workspace.id}`);
      router.refresh();
    } catch {
      setError("Bid workspace could not be started.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {pending ? "Starting bid…" : "Pursue / Start bid"}
        {!pending ? <ArrowRight className="size-4" /> : null}
      </button>
      {error ? (
        <span className="max-w-xs break-words text-xs text-red-700 [overflow-wrap:anywhere]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
