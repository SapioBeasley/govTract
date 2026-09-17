import assert from "node:assert/strict";
import test from "node:test";

import { houstonCheckbookAdapter } from "./adapter";

const sourceMeta = {
  packageName: "checkbook-2026",
  resourceId: "resource-2026-fixture",
  resourceRevision: "sha256:fixture-v1",
  resourceUrl:
    "https://openfinance.houstontx.gov/dataset/checkbook-2026/resource/resource-2026-fixture",
};

test("Houston Open Checkbook preserves payment semantics and deterministic source evidence", () => {
  const record = {
    source: sourceMeta,
    row: {
      _id: 42,
      "Fiscal Year": "2026",
      Department: "Parks & Recreation",
      Vendor: "HOUSTON GOLF ASSOCIATION INC",
      Amount: "400000.00",
      "Payment Date": "05/06/2026",
      "Document Type": "Vendor Invoice",
      "Document Number": "1900012345",
      Fund: "1000",
      "Fund Description": "General Fund",
      Account: "521415",
      "Account Description": "Land and Grounds Maintenance",
      "Purchase Order Number": "4500123456",
      "Contract Number": "4600012345",
      "WBS ID": "N-000123-0001",
    },
  };

  assert.equal(houstonCheckbookAdapter.source, "houston-open-checkbook");
  assert.deepEqual(houstonCheckbookAdapter.identify(record), {
    sourceRecordId: "checkbook-2026:42",
    sourceRevisionId: "sha256:fixture-v1",
  });

  const sourceRecord = houstonCheckbookAdapter.toSourceRecord(record, {
    agency: "City of Houston",
    canonicalUrl: "https://data.houstontx.gov/dataset/checkbook",
  });
  assert.equal(sourceRecord.sourceAgency, "City of Houston");
  assert.equal(sourceRecord.canonicalUrl, sourceMeta.resourceUrl);
  assert.deepEqual(sourceRecord.rawPayload, record.row);

  const normalized = houstonCheckbookAdapter.normalize(record, {
    agency: "City of Houston",
    canonicalUrl: "https://data.houstontx.gov/dataset/checkbook",
  });
  assert.equal(normalized.length, 1);

  const [payment] = normalized;
  assert.equal(payment?.sourceFactKey, "payment");
  assert.equal(payment?.recordType, "payment");
  assert.deepEqual(payment?.monetary, {
    type: "payment",
    amount: "400000.00",
    currency: "USD",
  });
  assert.equal(payment?.fiscalYear, 2026);
  assert.equal(payment?.occurredAt?.toISOString(), "2026-05-06T00:00:00.000Z");
  assert.deepEqual(payment?.buyer, {
    name: "City of Houston",
    unitName: "Parks & Recreation",
  });
  assert.deepEqual(payment?.vendor, {
    name: "HOUSTON GOLF ASSOCIATION INC",
  });
  assert.deepEqual(payment?.identifiers, [
    { type: "document", value: "1900012345" },
    { type: "purchase_order", value: "4500123456" },
    { type: "contract", value: "4600012345" },
    { type: "wbs", value: "N-000123-0001" },
    { type: "fund", value: "1000" },
    { type: "account", value: "521415" },
  ]);
  assert.deepEqual(payment?.metadata, {
    documentType: "Vendor Invoice",
    fundDescription: "General Fund",
    accountDescription: "Land and Grounds Maintenance",
    sourcePackage: "checkbook-2026",
    sourceResourceId: "resource-2026-fixture",
  });
});

test("Houston Open Checkbook accepts blank optional source fields without inventing procurement facts", () => {
  const record = {
    source: {
      ...sourceMeta,
      packageName: "checkbook-2025",
      resourceId: "resource-2025-fixture",
      resourceRevision: "sha256:fixture-v2",
    },
    row: {
      _id: 7,
      "Fiscal Year": "2025",
      Department: "Houston Public Works - HPW",
      Vendor: "",
      Amount: "",
      "Payment Date": "",
      "Document Type": "Service Rel. Order",
      "Purchase Order Number": "",
      "Contract Number": "",
      "WBS ID": "",
    },
  };

  const [payment] = houstonCheckbookAdapter.normalize(record, {
    agency: "City of Houston",
  });

  assert.equal(payment?.recordType, "payment");
  assert.equal(payment?.monetary, null);
  assert.equal(payment?.occurredAt, null);
  assert.deepEqual(payment?.buyer, {
    name: "City of Houston",
    unitName: "Houston Public Works - HPW",
  });
  assert.equal(payment?.vendor, null);
  assert.deepEqual(payment?.identifiers, []);
  assert.equal(payment?.metadata?.documentType, "Service Rel. Order");
});
