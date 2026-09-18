import assert from "node:assert/strict";
import test from "node:test";

import { houstonCheckbookAdapter } from "./adapter";

const sourceMeta = {
  packageName: "checkbook",
  resourceId: "371cca67-de22-4207-b5af-31cb3d567f04",
  resourceName: "Checkbook 2026",
  resourceRevision: "0ad055ee32389993999304c900d093a9",
  resourceModifiedAt: "2026-07-12T03:48:04.764178Z",
  resourceUrl:
    "https://data.houstontx.gov/dataset/4417c99b-bbba-4ecc-ba60-1a36ff4d8226/resource/371cca67-de22-4207-b5af-31cb3d567f04/download/checkbook-2026.csv",
};

test("Houston Open Checkbook preserves payment semantics and deterministic source evidence", () => {
  const record = {
    source: sourceMeta,
    row: {
      _id: 42,
      "Payment Document Number": "2001629993",
      "Fund ID": "8011",
      "Fund Name": "HAS-Airports Improvement",
      "Department ID": "2800",
      "Department Name": "Houston Airport System (HAS)",
      "WBS ID": "N-000123-0001",
      "WBS Description": "Fixture capital project",
      "GL Account Number": "520128",
      "GL Account Description": "Other Construction Work Services",
      "Vendor Name": "FIXTURE CONSTRUCTION LP",
      "Vendor Invoice": "EST5R PN1009",
      "Fiscal Year": "2026",
      "Clearing Date": "08/22/2025",
      Amount: "33315.20",
      "Type of procurement": "PO Cap Proj Release",
      "Purchase Order Number": "4200011796",
      "Purchase Order Item": "00010",
      "Contract Number": "4600018542",
    },
  };

  assert.equal(houstonCheckbookAdapter.source, "houston-open-checkbook");
  assert.deepEqual(houstonCheckbookAdapter.identify(record), {
    sourceRecordId: "371cca67-de22-4207-b5af-31cb3d567f04:42",
    sourceRevisionId: "0ad055ee32389993999304c900d093a9",
  });

  const sourceRecord = houstonCheckbookAdapter.toSourceRecord(record, {
    agency: "City of Houston",
    canonicalUrl: "https://data.houstontx.gov/dataset/checkbook",
  });
  assert.equal(sourceRecord.sourceAgency, "City of Houston");
  assert.equal(sourceRecord.canonicalUrl, sourceMeta.resourceUrl);
  assert.equal(sourceRecord.sourceModifiedAt?.toISOString(), "2026-07-12T03:48:04.764Z");
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
    amount: "33315.20",
    currency: "USD",
  });
  assert.equal(payment?.fiscalYear, 2026);
  assert.equal(payment?.occurredAt?.toISOString(), "2025-08-22T00:00:00.000Z");
  assert.deepEqual(payment?.buyer, {
    name: "City of Houston",
    unitName: "Houston Airport System (HAS)",
    sourceNativeId: "2800",
  });
  assert.deepEqual(payment?.vendor, {
    name: "FIXTURE CONSTRUCTION LP",
  });
  assert.deepEqual(payment?.identifiers, [
    { type: "payment_document", value: "2001629993" },
    { type: "vendor_invoice", value: "EST5R PN1009" },
    { type: "purchase_order", value: "4200011796" },
    { type: "purchase_order_item", value: "00010" },
    { type: "contract", value: "4600018542" },
    { type: "wbs", value: "N-000123-0001" },
    { type: "fund", value: "8011" },
    { type: "gl_account", value: "520128" },
  ]);
  assert.deepEqual(payment?.metadata, {
    procurementType: "PO Cap Proj Release",
    fundName: "HAS-Airports Improvement",
    wbsDescription: "Fixture capital project",
    glAccountDescription: "Other Construction Work Services",
    sourcePackage: "checkbook",
    sourceResourceId: "371cca67-de22-4207-b5af-31cb3d567f04",
    sourceResourceName: "Checkbook 2026",
  });
});

test("Houston Open Checkbook accepts blank optional source fields without inventing procurement facts", () => {
  const record = {
    source: {
      ...sourceMeta,
      resourceId: "f8f743f5-d190-4d5a-b183-027082dc088f",
      resourceName: "Checkbook 2025",
      resourceRevision: "06ca230b471eeba40271cf8c9f32dd29",
    },
    row: {
      _id: 7,
      "Fiscal Year": "2025",
      "Department ID": "2000",
      "Department Name": "Houston Public Works - HPW",
      "Vendor Name": "",
      Amount: "",
      "Clearing Date": "",
      "Type of procurement": "Service Rel. Order",
      "Payment Document Number": "",
      "Vendor Invoice": "",
      "Purchase Order Number": "",
      "Purchase Order Item": "",
      "Contract Number": "",
      "WBS ID": "",
      "Fund ID": "",
      "GL Account Number": "",
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
    sourceNativeId: "2000",
  });
  assert.equal(payment?.vendor, null);
  assert.deepEqual(payment?.identifiers, []);
  assert.equal(payment?.metadata?.procurementType, "Service Rel. Order");
});

test("Houston Open Checkbook preserves negative payment adjustments and rejects malformed nonblank amounts", () => {
  const negative = {
    source: sourceMeta,
    row: {
      _id: 2,
      "Fiscal Year": "2026",
      "Clearing Date": "08/22/2025",
      Amount: "-6460.89",
      "Vendor Name": "FIXTURE CONSTRUCTION LP",
      "Department ID": "2800",
      "Department Name": "Houston Airport System (HAS)",
      "Type of procurement": "Vendor Invoice",
    },
  };

  const [payment] = houstonCheckbookAdapter.normalize(negative, { agency: "City of Houston" });
  assert.equal(payment?.monetary?.amount, "-6460.89");

  assert.throws(
    () =>
      houstonCheckbookAdapter.normalize(
        {
          source: sourceMeta,
          row: { ...negative.row, _id: 3, Amount: "not-an-amount" },
        },
        { agency: "City of Houston" },
      ),
    /Invalid Houston Checkbook amount/,
  );
});
