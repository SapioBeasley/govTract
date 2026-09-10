export type LegacyMigrationRequirement =
  | { kind: "table"; name: string }
  | { kind: "column"; table: string; column: string };

export type LegacyMigrationState = "absent" | "present" | "partial";

export const legacyMigrationRequirements: Record<string, LegacyMigrationRequirement[]> = {
  "0000_ingestion_foundation.sql": [
    { kind: "table", name: "ingestion_runs" },
    { kind: "table", name: "ingestion_run_pages" },
    { kind: "table", name: "ingestion_record_errors" },
    { kind: "table", name: "source_records" },
    { kind: "table", name: "opportunities" },
    { kind: "table", name: "opportunity_documents" },
    { kind: "table", name: "opportunity_classifications" },
  ],
  "0001_document_versioning.sql": [
    { kind: "column", table: "opportunity_documents", column: "is_active" },
    { kind: "column", table: "opportunity_documents", column: "first_seen_at" },
    { kind: "column", table: "opportunity_documents", column: "last_seen_at" },
    { kind: "table", name: "opportunity_document_versions" },
  ],
  "0002_source_connections.sql": [
    { kind: "table", name: "source_connections" },
  ],
  "0003_document_extractions.sql": [
    { kind: "table", name: "document_extractions" },
    { kind: "table", name: "document_extraction_segments" },
    { kind: "table", name: "opportunity_document_version_extractions" },
  ],
  "0004_canonical_procurement_model.sql": [
    { kind: "table", name: "agencies" },
    { kind: "table", name: "opportunity_source_records" },
    { kind: "table", name: "vendors" },
    { kind: "table", name: "awards" },
    { kind: "table", name: "award_source_records" },
    { kind: "table", name: "opportunity_award_relationships" },
    { kind: "table", name: "intelligence_findings" },
    { kind: "table", name: "company_profiles" },
    { kind: "table", name: "opportunity_matches" },
    { kind: "table", name: "saved_opportunities" },
    { kind: "table", name: "bid_workspaces" },
    { kind: "table", name: "bid_requirements" },
    { kind: "table", name: "bid_sections" },
  ],
};

export function classifyLegacyMigrationState(results: boolean[]): LegacyMigrationState {
  if (results.length === 0) {
    throw new Error("Legacy migration detection requires at least one schema marker");
  }

  if (results.every(Boolean)) return "present";
  if (results.every((result) => !result)) return "absent";
  return "partial";
}

export function formatLegacyMigrationRequirement(requirement: LegacyMigrationRequirement) {
  if (requirement.kind === "table") return `public.${requirement.name}`;
  return `public.${requirement.table}.${requirement.column}`;
}
