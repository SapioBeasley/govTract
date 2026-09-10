import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  beaconOpportunityAdapter,
  type BeaconSolicitation,
} from "@/lib/procurement/sources/beacon/normalize";
import { defineProcurementSourceAdapterContract } from "./procurement-source-adapter.contract";

interface OpportunityFixture {
  context: {
    canonicalUrl: string;
    agency: string;
    canonicalStatus: string;
  };
  initial: BeaconSolicitation;
  updated: BeaconSolicitation;
  invalid: BeaconSolicitation;
  expected: {
    sourceRecordId: string;
    initialRevisionId: string;
    updatedRevisionId: string;
    initialTitle: string;
    updatedTitle: string;
    documentCount: number;
    classificationCount: number;
  };
}

interface PaginationFixture {
  pageSize: number;
  maxPages: number;
  complete: Array<{ reportedTotal: number; records: BeaconSolicitation[] }>;
  repeated: Array<{ reportedTotal: number; records: BeaconSolicitation[] }>;
}

function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "tests", "fixtures", "beacon", name), "utf8"),
  ) as T;
}

const opportunity = fixture<OpportunityFixture>("adapter-contract-opportunity.json");
const pagination = fixture<PaginationFixture>("adapter-contract-pagination.json");

defineProcurementSourceAdapterContract({
  name: "Beacon opportunity adapter",
  adapter: beaconOpportunityAdapter,
  context: opportunity.context,
  initial: opportunity.initial,
  updated: opportunity.updated,
  invalid: opportunity.invalid,
  expected: opportunity.expected,
  pagination,
  capabilities: {
    opportunityDetail: false,
    documents: false,
    amendments: false,
  },
  assertUpdatedNormalized(record) {
    assert.equal(record.documents?.length, opportunity.expected.documentCount);
    assert.equal(record.classifications?.length, opportunity.expected.classificationCount);
    assert.equal(record.documents?.[1]?.isAmendment, true);
    assert.equal(record.documents?.[1]?.sourceDocumentKey, "fixtures/contract/addendum-1.pdf");
  },
});
