import type { PersistableSourceRecord } from "@/lib/procurement/ingestion/persistence";

export type HistoricalProcurementRecordType =
  | "payment"
  | "purchase_order"
  | "release"
  | "invoice"
  | "contract"
  | "award"
  | "obligation"
  | "authorization"
  | "bid_result"
  | "other";

export type HistoricalProcurementMonetaryType =
  | "payment"
  | "obligation"
  | "award_amount"
  | "ceiling"
  | "unit_price"
  | "bid_amount"
  | "other";

export type HistoricalProcurementClassificationMethod =
  | "source_provided"
  | "authoritative_crosswalk"
  | "deterministic_rule"
  | "derived";

export interface HistoricalProcurementSourceIdentity {
  sourceRecordId: string;
  sourceRevisionId?: string | null;
}

export interface HistoricalProcurementSourceFileContext {
  id?: string | null;
  revision?: string | null;
  publishedAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface HistoricalProcurementSourceContext {
  agency?: string;
  canonicalUrl?: string | null;
  sourceFile?: HistoricalProcurementSourceFileContext | null;
}

export interface HistoricalProcurementSourceRecord extends PersistableSourceRecord {
  sourceAgency?: string | null;
}

export interface HistoricalProcurementIdentifier {
  type: string;
  value: string;
  evidence?: Record<string, unknown>;
}

export interface HistoricalProcurementClassification {
  sourceClassificationKey: string;
  scheme: string;
  code?: string | null;
  name?: string | null;
  method: HistoricalProcurementClassificationMethod;
  confidence?: number | null;
  evidence?: Record<string, unknown>;
}

export interface HistoricalProcurementPartyReference {
  normalizedId?: string | null;
  sourceNativeId?: string | null;
  name?: string | null;
}

export interface HistoricalProcurementBuyerReference extends HistoricalProcurementPartyReference {
  unitName?: string | null;
}

export interface HistoricalProcurementMonetaryFact {
  type: HistoricalProcurementMonetaryType;
  amount: string;
  currency?: string | null;
}

export interface NormalizedHistoricalProcurementRecord {
  sourceFactKey: string;
  recordType: HistoricalProcurementRecordType;
  title?: string | null;
  description?: string | null;
  occurredAt?: Date | null;
  fiscalYear?: number | null;
  monetary?: HistoricalProcurementMonetaryFact | null;
  buyer?: HistoricalProcurementBuyerReference | null;
  vendor?: HistoricalProcurementPartyReference | null;
  identifiers?: readonly HistoricalProcurementIdentifier[];
  classifications?: readonly HistoricalProcurementClassification[];
  metadata?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

export interface HistoricalProcurementSourceAdapter<
  TRawRecord extends Record<string, unknown>,
> {
  readonly source: string;
  identify(record: TRawRecord): HistoricalProcurementSourceIdentity;
  toSourceRecord(
    record: TRawRecord,
    context: HistoricalProcurementSourceContext,
  ): HistoricalProcurementSourceRecord;
  normalize(
    record: TRawRecord,
    context: HistoricalProcurementSourceContext,
  ): readonly NormalizedHistoricalProcurementRecord[];
}
