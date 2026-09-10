import type {
  PersistableOpportunityRecord,
  PersistableSourceRecord,
} from "@/lib/procurement/ingestion/persistence";
import type { ProcurementSourceAuthority } from "./authority";

export type { ProcurementSourceAuthority } from "./authority";

export interface ProcurementSourceIdentity {
  sourceRecordId: string;
  sourceRevisionId?: string | null;
}

export interface ProcurementSourceContext {
  canonicalUrl?: string | null;
  agency?: string;
  canonicalStatus?: string | null;
}

export interface ProcurementSourceLookup {
  identity: ProcurementSourceIdentity;
  canonicalUrl?: string | null;
}

export interface ProcurementSourceAdapter<TRawRecord extends Record<string, unknown>> {
  readonly source: string;
  readonly authority?: ProcurementSourceAuthority;
  identify(record: TRawRecord): ProcurementSourceIdentity;
  toSourceRecord(
    record: TRawRecord,
    context: ProcurementSourceContext,
  ): PersistableSourceRecord;
  normalizeOpportunity(
    record: TRawRecord,
    context: ProcurementSourceContext,
  ): PersistableOpportunityRecord;
  fetchOpportunityDetail?: (input: ProcurementSourceLookup) => Promise<TRawRecord | null>;
  fetchDocuments?: (
    input: ProcurementSourceLookup,
  ) => Promise<readonly Record<string, unknown>[]>;
  fetchAmendments?: (
    input: ProcurementSourceLookup,
  ) => Promise<readonly Record<string, unknown>[]>;
}

export function getProcurementSourceCapabilities<
  TRawRecord extends Record<string, unknown>,
>(adapter: ProcurementSourceAdapter<TRawRecord>) {
  return {
    opportunityDetail: typeof adapter.fetchOpportunityDetail === "function",
    documents: typeof adapter.fetchDocuments === "function",
    amendments: typeof adapter.fetchAmendments === "function",
  };
}
