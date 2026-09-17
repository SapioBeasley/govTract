import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import type { HistoricalProcurementSourceAdapter } from "@/lib/procurement/historical/adapter";
import {
  persistHistoricalProcurementSourceRecord,
  upsertHistoricalProcurementOpportunityRelationship,
  upsertHistoricalProcurementRelationship,
} from "@/lib/procurement/historical/persistence";
import { startIngestionRun } from "@/lib/procurement/ingestion/persistence";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

type FixtureRecord = Record<string, unknown> & {
  id: string;
  factKey: string;
  recordType: "payment" | "contract";
  agencyId: string;
  vendorId: string;
};

function uniqueSource() {
  sequence += 1;
  return `historical-relationships-${process.pid}-${Date.now()}-${sequence}`;
}

function fixtureAdapter(source: string): HistoricalProcurementSourceAdapter<FixtureRecord> {
  return {
    source,
    identify(record) {
      return { sourceRecordId: record.id, sourceRevisionId: "1" };
    },
    toSourceRecord(record) {
      return {
        sourceRecordId: record.id,
        sourceRevisionId: "1",
        rawPayload: record,
      };
    },
    normalize(record) {
      return [
        {
          sourceFactKey: record.factKey,
          recordType: record.recordType,
          monetary:
            record.recordType === "payment"
              ? { type: "payment", amount: "250.00", currency: "USD" }
              : { type: "ceiling", amount: "1000.00", currency: "USD" },
          buyer: {
            normalizedId: record.agencyId,
            sourceNativeId: "DEPT-100",
            name: "Fixture Department",
          },
          vendor: {
            normalizedId: record.vendorId,
            sourceNativeId: "VENDOR-100",
            name: "Fixture Vendor LLC",
          },
          identifiers: [{ type: "contract", value: "CONTRACT-100" }],
          metadata: {},
          evidence: { identifier: "CONTRACT-100" },
        },
      ];
    },
  };
}

async function cleanup(input: {
  source: string;
  runId: string;
  agencyId: string;
  vendorId: string;
  opportunitySource: string;
}) {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`
      DELETE FROM historical_procurement_records
      WHERE id IN (
        SELECT hpsr.historical_procurement_record_id
        FROM historical_procurement_source_records hpsr
        INNER JOIN source_records sr ON sr.id = hpsr.source_record_id
        WHERE sr.source = ${input.source}
      )
    `;
    await sql`DELETE FROM opportunities WHERE source = ${input.opportunitySource}`;
    await sql`DELETE FROM source_records WHERE source IN (${input.source}, ${input.opportunitySource})`;
    await sql`DELETE FROM ingestion_runs WHERE id = ${input.runId}`;
    await sql`DELETE FROM vendors WHERE id = ${input.vendorId}`;
    await sql`DELETE FROM agencies WHERE id = ${input.agencyId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test(
  "historical procurement links normalized parties while preserving source identity and deterministic relationships",
  { skip: !canRun },
  async () => {
    const source = uniqueSource();
    const opportunitySource = `${source}-opportunity`;
    await closeDb();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    const [{ id: agencyId }] = await sql<{ id: string }[]>`
      INSERT INTO agencies (canonical_name, slug)
      VALUES ('Fixture Department', ${`${source}-agency`})
      RETURNING id
    `;
    const [{ id: vendorId }] = await sql<{ id: string }[]>`
      INSERT INTO vendors (canonical_name, legal_name)
      VALUES ('Fixture Vendor LLC', 'Fixture Vendor LLC')
      RETURNING id
    `;
    await sql.end({ timeout: 5 });

    const runId = await startIngestionRun({ source, scope: "historical" });
    const adapter = fixtureAdapter(source);

    try {
      const payment = await persistHistoricalProcurementSourceRecord({
        adapter,
        runId,
        record: {
          id: "PAYMENT-1",
          factKey: "payment",
          recordType: "payment",
          agencyId,
          vendorId,
        },
        context: {},
      });
      const contract = await persistHistoricalProcurementSourceRecord({
        adapter,
        runId,
        record: {
          id: "CONTRACT-1",
          factKey: "contract",
          recordType: "contract",
          agencyId,
          vendorId,
        },
        context: {},
      });

      const paymentId = payment.records[0]!.historicalProcurementRecordId;
      const contractId = contract.records[0]!.historicalProcurementRecordId;

      const relationshipId = await upsertHistoricalProcurementRelationship({
        fromHistoricalProcurementRecordId: paymentId,
        toHistoricalProcurementRecordId: contractId,
        relationshipType: "paid_against_contract",
        method: "deterministic_identifier",
        confidence: 100,
        evidence: { contractNumber: "CONTRACT-100" },
      });
      const replayRelationshipId = await upsertHistoricalProcurementRelationship({
        fromHistoricalProcurementRecordId: paymentId,
        toHistoricalProcurementRecordId: contractId,
        relationshipType: "paid_against_contract",
        method: "deterministic_identifier",
        confidence: 95,
        evidence: { contractNumber: "CONTRACT-100", corroborated: true },
      });
      assert.equal(replayRelationshipId, relationshipId);

      const opportunitySql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      const [{ id: opportunitySourceRecordId }] = await opportunitySql<{ id: string }[]>`
        INSERT INTO source_records (
          source,
          source_record_id,
          raw_payload,
          payload_hash
        )
        VALUES (
          ${opportunitySource},
          'OPP-1',
          '{}'::jsonb,
          'fixture'
        )
        RETURNING id
      `;
      const [{ id: opportunityId }] = await opportunitySql<{ id: string }[]>`
        INSERT INTO opportunities (
          source_record_id,
          source,
          source_opportunity_id,
          title
        )
        VALUES (
          ${opportunitySourceRecordId},
          ${opportunitySource},
          'OPP-1',
          'Fixture recompete'
        )
        RETURNING id
      `;
      await opportunitySql.end({ timeout: 5 });

      const opportunityRelationshipId = await upsertHistoricalProcurementOpportunityRelationship({
        historicalProcurementRecordId: contractId,
        opportunityId,
        relationshipType: "predecessor_evidence",
        method: "deterministic_identifier",
        confidence: 90,
        evidence: { contractNumber: "CONTRACT-100" },
      });
      const replayOpportunityRelationshipId = await upsertHistoricalProcurementOpportunityRelationship({
        historicalProcurementRecordId: contractId,
        opportunityId,
        relationshipType: "predecessor_evidence",
        method: "deterministic_identifier",
        confidence: 92,
        evidence: { contractNumber: "CONTRACT-100", sourceConfirmed: true },
      });
      assert.equal(replayOpportunityRelationshipId, opportunityRelationshipId);

      const verifySql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
      try {
        const [partyLink] = await verifySql<{
          agency_id: string | null;
          vendor_id: string | null;
          buyer_source_id: string | null;
          vendor_source_id: string | null;
        }[]>`
          SELECT agency_id, vendor_id, buyer_source_id, vendor_source_id
          FROM historical_procurement_records
          WHERE id = ${paymentId}
        `;
        const [relationship] = await verifySql<{
          count: number;
          confidence: number | null;
          evidence: Record<string, unknown>;
        }[]>`
          SELECT count(*) OVER ()::int AS count, confidence, evidence
          FROM historical_procurement_relationships
          WHERE id = ${relationshipId}
        `;
        const [opportunityRelationship] = await verifySql<{
          count: number;
          confidence: number | null;
          evidence: Record<string, unknown>;
        }[]>`
          SELECT count(*) OVER ()::int AS count, confidence, evidence
          FROM historical_procurement_opportunity_relationships
          WHERE id = ${opportunityRelationshipId}
        `;

        assert.deepEqual(partyLink, {
          agency_id: agencyId,
          vendor_id: vendorId,
          buyer_source_id: "DEPT-100",
          vendor_source_id: "VENDOR-100",
        });
        assert.deepEqual(relationship, {
          count: 1,
          confidence: 95,
          evidence: { contractNumber: "CONTRACT-100", corroborated: true },
        });
        assert.deepEqual(opportunityRelationship, {
          count: 1,
          confidence: 92,
          evidence: { contractNumber: "CONTRACT-100", sourceConfirmed: true },
        });
      } finally {
        await verifySql.end({ timeout: 5 });
      }
    } finally {
      await cleanup({ source, runId, agencyId, vendorId, opportunitySource });
    }
  },
);
