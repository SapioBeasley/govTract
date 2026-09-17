import assert from "node:assert/strict";
import test from "node:test";

import {
  HoustonCheckbookClient,
  extractHoustonCheckbookResources,
} from "./client";

const packageFixture = {
  name: "checkbook",
  title: "Checkbook",
  metadata_modified: "2026-07-12T03:48:04.792009",
  resources: [
    {
      id: "visual",
      name: "Visual Report",
      format: "",
      datastore_active: false,
      hash: "",
      url: "https://example.invalid/report",
    },
    {
      id: "resource-2026",
      name: "Checkbook 2026",
      format: "CSV",
      datastore_active: true,
      last_modified: "2026-07-12T03:48:04.764178",
      hash: "hash-2026",
      url: "https://data.houstontx.gov/download/checkbook-2026.csv",
    },
    {
      id: "resource-2025",
      name: "Checkbook 2025",
      format: "CSV",
      datastore_active: true,
      last_modified: "2025-07-11T19:24:53.414315",
      hash: "hash-2025",
      url: "https://data.houstontx.gov/download/checkbook-2025.csv",
    },
    {
      id: "resource-2024",
      name: "Checkbook 2024",
      format: "CSV",
      datastore_active: true,
      last_modified: null,
      hash: "",
      url: "https://data.houstontx.gov/download/checkbook-2024.csv",
    },
  ],
};

test("extractHoustonCheckbookResources selects active fiscal-year CSV resources deterministically", () => {
  assert.deepEqual(extractHoustonCheckbookResources(packageFixture), [
    {
      fiscalYear: 2024,
      packageName: "checkbook",
      resourceId: "resource-2024",
      resourceName: "Checkbook 2024",
      resourceRevision: "2026-07-12T03:48:04.792009",
      resourceModifiedAt: null,
      resourceUrl: "https://data.houstontx.gov/download/checkbook-2024.csv",
    },
    {
      fiscalYear: 2025,
      packageName: "checkbook",
      resourceId: "resource-2025",
      resourceName: "Checkbook 2025",
      resourceRevision: "hash-2025",
      resourceModifiedAt: "2025-07-11T19:24:53.414315",
      resourceUrl: "https://data.houstontx.gov/download/checkbook-2025.csv",
    },
    {
      fiscalYear: 2026,
      packageName: "checkbook",
      resourceId: "resource-2026",
      resourceName: "Checkbook 2026",
      resourceRevision: "hash-2026",
      resourceModifiedAt: "2026-07-12T03:48:04.764178",
      resourceUrl: "https://data.houstontx.gov/download/checkbook-2026.csv",
    },
  ]);
});

test("HoustonCheckbookClient discovers the authoritative checkbook package and pages datastore rows", async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);

    if (url.includes("package_show")) {
      return new Response(JSON.stringify({ success: true, result: packageFixture }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.includes("datastore_search")) {
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            fields: [
              { id: "_id", type: "int" },
              { id: "Amount", type: "text" },
            ],
            records: [
              { _id: 101, Amount: "12.34" },
              { _id: 102, Amount: "56.78" },
            ],
            total: 271696,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  const client = new HoustonCheckbookClient({ fetchImpl: fakeFetch });
  const resources = await client.discoverResources();
  assert.equal(resources.at(-1)?.fiscalYear, 2026);

  const page = await client.fetchPage(resources.at(-1)!, { limit: 2, offset: 100 });
  assert.equal(page.total, 271696);
  assert.deepEqual(page.records, [
    { _id: 101, Amount: "12.34" },
    { _id: 102, Amount: "56.78" },
  ]);
  assert.match(calls[0]!, /package_show\?id=checkbook$/);
  assert.match(calls[1]!, /resource_id=resource-2026/);
  assert.match(calls[1]!, /limit=2/);
  assert.match(calls[1]!, /offset=100/);
});

test("HoustonCheckbookClient fails closed on malformed CKAN responses", async () => {
  const client = new HoustonCheckbookClient({
    fetchImpl: async () =>
      new Response(JSON.stringify({ success: false, error: { message: "bad query" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  await assert.rejects(() => client.discoverResources(), /Houston CKAN request failed/);
});
