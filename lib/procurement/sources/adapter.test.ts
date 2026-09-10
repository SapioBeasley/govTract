import assert from "node:assert/strict";
import test from "node:test";

import {
  getProcurementSourceCapabilities,
  type ProcurementSourceAdapter,
} from "./adapter";

type FixtureRecord = Record<string, unknown> & {
  id: string;
  title: string;
};

function fixtureAdapter(): ProcurementSourceAdapter<FixtureRecord> {
  return {
    source: "fixture",
    identify(record) {
      return { sourceRecordId: record.id };
    },
    toSourceRecord(record, context) {
      return {
        sourceRecordId: record.id,
        canonicalUrl: context.canonicalUrl,
        rawPayload: record,
      };
    },
    normalizeOpportunity(record, context) {
      return {
        sourceRecordId: record.id,
        canonicalUrl: context.canonicalUrl,
        rawPayload: record,
        title: record.title,
        status: context.canonicalStatus ?? null,
        agencySlug: context.agency ?? null,
        departments: [],
        categories: [],
      };
    },
  };
}

test("source adapter detail, document, and amendment capabilities are optional", () => {
  const base = fixtureAdapter();
  assert.deepEqual(getProcurementSourceCapabilities(base), {
    opportunityDetail: false,
    documents: false,
    amendments: false,
  });

  const complete: ProcurementSourceAdapter<FixtureRecord> = {
    ...base,
    fetchOpportunityDetail: async () => null,
    fetchDocuments: async () => [],
    fetchAmendments: async () => [],
  };
  assert.deepEqual(getProcurementSourceCapabilities(complete), {
    opportunityDetail: true,
    documents: true,
    amendments: true,
  });
});
