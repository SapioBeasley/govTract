import { persistIdentityResolvedOpportunity } from "@/lib/procurement/identity/persistence";
import { persistSourceRecord } from "@/lib/procurement/ingestion/persistence";
import type {
  ProcurementSourceAdapter,
  ProcurementSourceContext,
  ProcurementSourceIdentity,
} from "@/lib/procurement/sources/adapter";

function assertStableIdentity(input: {
  stage: "source record" | "normalized opportunity";
  expected: ProcurementSourceIdentity;
  actualSourceRecordId: string;
}) {
  if (input.actualSourceRecordId !== input.expected.sourceRecordId) {
    throw new Error(
      `Procurement source adapter identity mismatch at ${input.stage}: expected ${input.expected.sourceRecordId}, received ${input.actualSourceRecordId}`,
    );
  }
}

export async function persistProcurementSourceRecord<
  TRawRecord extends Record<string, unknown>,
>(input: {
  adapter: ProcurementSourceAdapter<TRawRecord>;
  runId: string;
  record: TRawRecord;
  context: ProcurementSourceContext;
}) {
  const identity = input.adapter.identify(input.record);
  if (!identity.sourceRecordId.trim()) {
    throw new Error(`Procurement source adapter ${input.adapter.source} returned an empty source record id`);
  }

  const sourceRecord = input.adapter.toSourceRecord(input.record, input.context);
  assertStableIdentity({
    stage: "source record",
    expected: identity,
    actualSourceRecordId: sourceRecord.sourceRecordId,
  });

  // Raw source evidence is persisted before destructive/derived normalization so a
  // malformed normalized record cannot erase the fetched source payload.
  const persisted = await persistSourceRecord({
    runId: input.runId,
    source: input.adapter.source,
    agency: input.context.agency,
    record: sourceRecord,
  });

  const normalized = input.adapter.normalizeOpportunity(input.record, input.context);
  assertStableIdentity({
    stage: "normalized opportunity",
    expected: identity,
    actualSourceRecordId: normalized.sourceRecordId,
  });

  const canonical = await persistIdentityResolvedOpportunity({
    source: input.adapter.source,
    sourceRecordPk: persisted.sourceRecordPk,
    record: normalized,
    sourceAuthority: input.adapter.authority ?? "unknown",
  });

  return {
    ...persisted,
    identity,
    canonicalOpportunityId: canonical.opportunityId,
    identityResolution: canonical.identityResolution,
  };
}
