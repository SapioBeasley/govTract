import { Settings } from "lucide-react";
import { SectionShell } from "@/components/section-shell";

export default function AdminPage() {
  return <SectionShell eyebrow="Operate" title="Admin" description="Inspect source ingestion, processing state, provenance, and operational diagnostics as the platform grows." icon={Settings} />;
}
