import { Settings } from "lucide-react";

import { BeaconConnectionCard } from "@/components/beacon-connection-card";
import { SectionShell } from "@/components/section-shell";

export default function AdminPage() {
  return (
    <SectionShell
      eyebrow="Operate"
      title="Admin"
      description="Manage procurement source connections, ingestion state, provenance, and operational diagnostics."
      icon={Settings}
    >
      <BeaconConnectionCard />
    </SectionShell>
  );
}
