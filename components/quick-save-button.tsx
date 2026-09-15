"use client";

import { Check, Heart, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type { SavedOpportunityStatus } from "@/lib/opportunities/saved";

const STATUS_LABELS: Record<SavedOpportunityStatus, string> = {
  saved: "Saved",
  reviewing: "Reviewing",
  pursuing: "Pursuing",
  no_bid: "No Bid",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
};

export function QuickSaveButton({ opportunityId }: { opportunityId: string }) {
  const [status, setStatus] = useState<SavedOpportunityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch(`/api/opportunities/${opportunityId}/saved`)
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { saved?: { status?: SavedOpportunityStatus } | null };
      })
      .then((payload) => {
        if (active) setStatus(payload?.saved?.status ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [opportunityId]);

  async function save() {
    setPending(true);
    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/saved`, { method: "POST" });
      if (!response.ok) return;
      const payload = (await response.json()) as { saved?: { status?: SavedOpportunityStatus } | null };
      setStatus(payload.saved?.status ?? "saved");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={status ? undefined : save}
      disabled={loading || pending || Boolean(status)}
      className="inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-[var(--muted)] disabled:cursor-default disabled:opacity-80"
    >
      {loading || pending ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : status ? (
        <Check className="size-4" />
      ) : (
        <Heart className="size-4" />
      )}
      {status ? STATUS_LABELS[status] : "Save"}
    </button>
  );
}
