"use client";

import { usePathname } from "next/navigation";

import { QuickSaveButton } from "@/components/quick-save-button";

const DETAIL_PATH = /^\/opportunities\/([0-9a-f-]{36})$/i;

export function OpportunityDetailSaveFloat() {
  const pathname = usePathname();
  const match = DETAIL_PATH.exec(pathname);
  if (!match?.[1]) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 rounded-xl bg-white/95 p-1 shadow-lg ring-1 ring-black/10 backdrop-blur sm:bottom-6 sm:right-6">
      <QuickSaveButton opportunityId={match[1]} />
    </div>
  );
}
