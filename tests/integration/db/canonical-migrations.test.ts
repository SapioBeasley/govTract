import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const databaseHost = DATABASE_URL ? new URL(DATABASE_URL).hostname : "";
const canRun = Boolean(DATABASE_URL) && ["127.0.0.1", "localhost", "::1"].includes(databaseHost);
let sequence = 0;

function uniqueDatabaseName() {
  sequence += 1;
  return `govtract_canonical_${process.pid}_${Date.now()}_${sequence}`;
}

function databaseUrlFor(name: string) {
  const url = new URL(DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

function adminDatabaseUrl() {
  const url = new URL(DATABASE_URL);
  url.pathname = "/postgres";
  return url.toString();
}

function runMigrations(databaseUrl: string, args: string[] = []) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(command, ["run", "db:migrate", "--", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
}

async function withTemporaryDatabase(
  callback: (databaseUrl: string, sql: postgres.Sql) => Promise<void>,
) {
  const admin = postgres(adminDatabaseUrl(), { max: 1, prepare: false });
  const databaseName = uniqueDatabaseName();
  const databaseUrl = databaseUrlFor(databaseName);
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    const sql = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      await callback(databaseUrl, sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
  } finally {
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end({ timeout: 5 });
  }
}

async function applyRawMigrations(sql: postgres.Sql, versions: string[]) {
  for (const version of versions) {
    const migrationSql = await readFile(resolve(process.cwd(), "drizzle", version), "utf8");
    await sql.unsafe(migrationSql);
  }
}

async function assertRejectsSql(
  operation: () => Promise<unknown>,
  expectedConstraint: string,
) {
  await assert.rejects(operation, (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, new RegExp(expectedConstraint));
    return true;
  });
}

test(
  "canonical migration chain applies from empty, reruns idempotently, and enforces core schema invariants",
  { skip: !canRun },
  async () => {
    await withTemporaryDatabase(async (databaseUrl, sql) => {
      const first = runMigrations(databaseUrl);
      assert.equal(first.status, 0, first.stderr || first.stdout);

      const expectedTables = [
        "agencies",
        "opportunity_source_records",
        "vendors",
        "awards",
        "award_source_records",
        "opportunity_award_relationships",
        "intelligence_findings",
        "company_profiles",
        "opportunity_matches",
        "saved_opportunities",
        "bid_workspaces",
        "bid_requirements",
        "bid_sections",
      ];
      const tableRows = await sql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY(${expectedTables})
        ORDER BY table_name
      `;
      assert.deepEqual(
        tableRows.map((row) => row.table_name),
        [...expectedTables].sort(),
      );

      const expectedIndexes = [
        "agencies_uei_idx",
        "opportunity_source_records_source_record_uidx",
        "vendors_uei_uidx",
        "awards_piid_idx",
        "opportunity_award_relationships_uidx",
        "opportunity_matches_profile_fingerprint_uidx",
        "saved_opportunities_opportunity_profile_uidx",
        "bid_workspaces_opportunity_profile_uidx",
      ];
      const indexRows = await sql<{ indexname: string }[]>`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY(${expectedIndexes})
        ORDER BY indexname
      `;
      assert.deepEqual(
        indexRows.map((row) => row.indexname),
        [...expectedIndexes].sort(),
      );

      const expectedConstraints = [
        "opportunity_source_records_confidence_check",
        "award_source_records_confidence_check",
        "opportunity_award_relationships_confidence_check",
        "intelligence_findings_subject_check",
        "intelligence_findings_confidence_check",
        "opportunity_matches_score_check",
      ];
      const constraintRows = await sql<{ conname: string }[]>`
        SELECT conname
        FROM pg_constraint
        WHERE conname = ANY(${expectedConstraints})
        ORDER BY conname
      `;
      assert.deepEqual(
        constraintRows.map((row) => row.conname),
        [...expectedConstraints].sort(),
      );

      const [agency] = await sql<{ id: string }[]>`
        INSERT INTO agencies (canonical_name, slug)
        VALUES ('Nullable Agency', 'nullable-agency')
        RETURNING id
      `;
      const [vendor] = await sql<{ id: string }[]>`
        INSERT INTO vendors (canonical_name)
        VALUES ('Nullable Vendor')
        RETURNING id
      `;
      const [award] = await sql<{ id: string }[]>`
        INSERT INTO awards (title)
        VALUES ('Nullable Award')
        RETURNING id
      `;
      assert.ok(agency?.id);
      assert.ok(vendor?.id);
      assert.ok(award?.id);

      await assertRejectsSql(
        () => sql`INSERT INTO opportunity_source_records (
          opportunity_id, source_record_id, confidence
        ) VALUES (
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
          101
        )`,
        "opportunity_source_records_confidence_check",
      );

      await assertRejectsSql(
        () => sql`INSERT INTO intelligence_findings (
          finding_type, summary, derivation_method
        ) VALUES ('incumbent', 'No subject', 'deterministic')`,
        "intelligence_findings_subject_check",
      );

      const migrationRowsBefore = await sql<{ version: string }[]>`
        SELECT version FROM govtract_migrations ORDER BY version
      `;
      const second = runMigrations(databaseUrl);
      assert.equal(second.status, 0, second.stderr || second.stdout);
      const migrationRowsAfter = await sql<{ version: string }[]>`
        SELECT version FROM govtract_migrations ORDER BY version
      `;
      assert.deepEqual(migrationRowsAfter, migrationRowsBefore);

      const [agencyCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM agencies WHERE slug = 'nullable-agency'
      `;
      assert.equal(agencyCount?.count, 1);
    });
  },
);

test(
  "canonical backfill preserves opportunity identity and produces deterministic agency/source links",
  { skip: !canRun },
  async () => {
    await withTemporaryDatabase(async (databaseUrl, sql) => {
      await applyRawMigrations(sql, [
        "0000_ingestion_foundation.sql",
        "0001_document_versioning.sql",
        "0002_source_connections.sql",
        "0003_document_extractions.sql",
      ]);

      const opportunityId = "11111111-1111-4111-8111-111111111111";
      const [sourceRecord] = await sql<{ id: string }[]>`
        INSERT INTO source_records (
          source, source_record_id, source_agency, raw_payload, payload_hash
        ) VALUES (
          'fixture-source', 'fixture-record-1', 'Fixture Agency', '{}'::jsonb, 'fixture-hash'
        ) RETURNING id
      `;
      assert.ok(sourceRecord?.id);

      await sql`
        INSERT INTO opportunities (
          id, source_record_id, source, source_opportunity_id, title,
          agency_name, agency_slug, solicitation_number
        ) VALUES (
          ${opportunityId}, ${sourceRecord.id}, 'fixture-source', 'fixture-opportunity-1',
          'Existing opportunity', 'Fixture Agency', 'fixture-agency', NULL
        )
      `;

      const migration = runMigrations(databaseUrl, ["--baseline-existing"]);
      assert.equal(migration.status, 0, migration.stderr || migration.stdout);

      const [opportunity] = await sql<{ id: string; solicitation_number: string | null }[]>`
        SELECT id, solicitation_number
        FROM opportunities
        WHERE source_record_id = ${sourceRecord.id}
      `;
      assert.equal(opportunity?.id, opportunityId);
      assert.equal(opportunity?.solicitation_number, null);

      const [link] = await sql<
        {
          opportunity_id: string;
          source_record_id: string;
          agency_slug: string | null;
          confidence: number | null;
        }[]
      >`
        SELECT osr.opportunity_id, osr.source_record_id, a.slug AS agency_slug, osr.confidence
        FROM opportunity_source_records osr
        LEFT JOIN agencies a ON a.id = osr.agency_id
        WHERE osr.source_record_id = ${sourceRecord.id}
      `;
      assert.equal(link?.opportunity_id, opportunityId);
      assert.equal(link?.source_record_id, sourceRecord.id);
      assert.equal(link?.agency_slug, "fixture-agency");
      assert.equal(link?.confidence, 100);

      const rerun = runMigrations(databaseUrl, ["--baseline-existing"]);
      assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);

      const [counts] = await sql<{ agencies: number; links: number }[]>`
        SELECT
          (SELECT count(*)::int FROM agencies WHERE slug = 'fixture-agency') AS agencies,
          (SELECT count(*)::int FROM opportunity_source_records WHERE source_record_id = ${sourceRecord.id}) AS links
      `;
      assert.deepEqual(counts, { agencies: 1, links: 1 });

      const [secondSource] = await sql<{ id: string }[]>`
        INSERT INTO source_records (
          source, source_record_id, raw_payload, payload_hash
        ) VALUES ('fixture-source', 'fixture-record-2', '{}'::jsonb, 'fixture-hash-2')
        RETURNING id
      `;
      const [secondOpportunity] = await sql<{ id: string }[]>`
        INSERT INTO opportunities (
          source_record_id, source, source_opportunity_id, title
        ) VALUES (${secondSource.id}, 'fixture-source', 'fixture-opportunity-2', 'Second opportunity')
        RETURNING id
      `;
      assert.ok(secondOpportunity?.id);

      await assertRejectsSql(
        () => sql`
          INSERT INTO opportunity_source_records (
            opportunity_id, source_record_id, is_primary, link_method, confidence
          ) VALUES (${secondOpportunity.id}, ${sourceRecord.id}, false, 'direct', 100)
        `,
        "opportunity_source_records_source_record_uidx",
      );
    });
  },
);

test(
  "migration journal rejects checksum drift for an already-applied canonical migration",
  { skip: !canRun },
  async () => {
    await withTemporaryDatabase(async (databaseUrl, sql) => {
      const first = runMigrations(databaseUrl);
      assert.equal(first.status, 0, first.stderr || first.stdout);

      await sql`
        UPDATE govtract_migrations
        SET checksum = 'not-the-repository-checksum'
        WHERE version = '0004_canonical_procurement_model.sql'
      `;

      const rerun = runMigrations(databaseUrl);
      assert.notEqual(rerun.status, 0);
      assert.match(
        `${rerun.stderr}\n${rerun.stdout}`,
        /Migration 0004_canonical_procurement_model\.sql has changed after it was applied/,
      );
    });
  },
);
