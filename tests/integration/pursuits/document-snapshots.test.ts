import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import { saveOpportunity, updateSavedOpportunity } from "@/lib/opportunities/saved";
import {
  SnapshotRetrievalError,
  ensurePursuitSnapshotPrepared,
  getLatestPursuitSnapshot,
  processPursuitSnapshot,
  type PursuitDocumentRetriever,
  type SnapshotArtifactStore,
} from "@/lib/procurement/pursuits/snapshot";

const canRun = Boolean(process.env.DATABASE_URL);
let sequence = 0;

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

async function seedOpportunity() {
  sequence += 1;
  const suffix = `${process.pid}-${Date.now()}-${sequence}`;
  const sourceOpportunityId = `opp-${suffix}`;
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const [sourceRecord] = await sql<{ id: string }[]>`
      INSERT INTO source_records (source, source_record_id, raw_payload, payload_hash)
      VALUES ('snapshot-test', ${`record-${suffix}`}, '{}'::jsonb, ${`hash-${suffix}`})
      RETURNING id
    `;
    const [opportunity] = await sql<{ id: string }[]>`
      INSERT INTO opportunities (
        source_record_id, source, source_opportunity_id, title, agency_name
      ) VALUES (
        ${sourceRecord!.id}, 'snapshot-test', ${sourceOpportunityId},
        ${`Snapshot fixture ${suffix}`}, 'City of Houston'
      ) RETURNING id
    `;

    const documents = [
      { key: `solicitation-${suffix}.pdf`, name: "Solicitation.pdf", bytes: "solicitation-v1", amendment: false },
      { key: `pricing-${suffix}.xlsx`, name: "Pricing.xlsx", bytes: "pricing-v1", amendment: false },
    ];

    for (const document of documents) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO opportunity_documents (
          opportunity_id, source_document_key, name, mime_type, file_size_bytes, source_metadata
        ) VALUES (
          ${opportunity!.id}, ${document.key}, ${document.name},
          ${document.name.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
          ${Buffer.byteLength(document.bytes)}, '{}'::jsonb
        ) RETURNING id
      `;
      await sql`
        INSERT INTO opportunity_document_versions (
          opportunity_document_id, version_number, fingerprint, checksum_sha256,
          retrieved_at, name, mime_type, file_size_bytes, is_amendment, source_metadata
        ) VALUES (
          ${row!.id}, 1, ${sha256(`${document.key}-metadata`)}, ${sha256(document.bytes)},
          now(), ${document.name},
          ${document.name.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
          ${Buffer.byteLength(document.bytes)}, ${document.amendment}, '{}'::jsonb
        )
      `;
    }

    return {
      opportunityId: opportunity!.id,
      sourceOpportunityId,
      sourceRecordId: sourceRecord!.id,
      documents,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function cleanup(sourceRecordId: string) {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM source_records WHERE id = ${sourceRecordId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function fixtureRetriever(fixtures: Map<string, string | SnapshotRetrievalError>): PursuitDocumentRetriever {
  return {
    async retrieveToFile(input) {
      const fixture = fixtures.get(input.sourceDocumentKey);
      if (fixture instanceof SnapshotRetrievalError) throw fixture;
      if (fixture === undefined) {
        throw new SnapshotRetrievalError("missing", "Fixture document is unavailable");
      }
      await writeFile(input.destinationPath, fixture);
      return {
        retrievedAt: new Date("2026-09-15T04:00:00.000Z"),
        mimeType: input.mimeType,
      };
    },
  };
}

function memoryArtifactStore() {
  const objects = new Map<string, Buffer>();
  const store: SnapshotArtifactStore = {
    provider: "memory",
    async putFile(input) {
      const body = await readFile(input.filePath);
      objects.set(input.storageKey, body);
      return { storageKey: input.storageKey, etag: sha256(body) };
    },
  };
  return { store, objects };
}

test("Saved stays lightweight while entering Pursuing prepares the current authoritative document set", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  try {
    await saveOpportunity({ opportunityId: fixture.opportunityId });
    await closeDb();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [{ count: savedOnlyCount }] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM pursuit_document_snapshots
        WHERE opportunity_id = ${fixture.opportunityId}
      `;
      assert.equal(savedOnlyCount, 0);
    } finally {
      await sql.end({ timeout: 5 });
    }

    await updateSavedOpportunity(fixture.opportunityId, { status: "pursuing" });
    const prepared = await getLatestPursuitSnapshot(fixture.opportunityId);
    assert.ok(prepared);
    assert.equal(prepared.status, "incomplete");
    assert.equal(prepared.documents.length, 2);
    assert.ok(prepared.documents.every((document) => document.status === "pending"));
  } finally {
    await cleanup(fixture.sourceRecordId);
  }
});

test("snapshot retrieval preserves the source opportunity identity required by source-specific download routes", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  const tempRoot = await mkdtemp(join(tmpdir(), "govtract-snapshot-source-id-"));
  try {
    await saveOpportunity({ opportunityId: fixture.opportunityId });
    await updateSavedOpportunity(fixture.opportunityId, { status: "pursuing" });
    const prepared = await ensurePursuitSnapshotPrepared(fixture.opportunityId);
    const seen = new Set<string>();
    const retriever: PursuitDocumentRetriever = {
      async retrieveToFile(input) {
        seen.add(input.sourceOpportunityId);
        const fixtureDocument = fixture.documents.find(
          (document) => document.key === input.sourceDocumentKey,
        );
        assert.ok(fixtureDocument);
        await writeFile(input.destinationPath, fixtureDocument.bytes);
        return {
          retrievedAt: new Date("2026-09-15T04:00:00.000Z"),
          mimeType: input.mimeType,
        };
      },
    };
    const { store } = memoryArtifactStore();

    await processPursuitSnapshot(prepared.id, {
      retriever,
      artifactStore: store,
      tempRoot,
      maxDocumentBytes: 1024 * 1024,
      maxSnapshotBytes: 4 * 1024 * 1024,
    });

    assert.deepEqual([...seen], [fixture.sourceOpportunityId]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await cleanup(fixture.sourceRecordId);
  }
});

test("snapshot materialization is idempotent, stores exact bytes outside Postgres, and deduplicates artifacts by checksum", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  const tempRoot = await mkdtemp(join(tmpdir(), "govtract-snapshot-test-"));
  try {
    await saveOpportunity({ opportunityId: fixture.opportunityId });
    await updateSavedOpportunity(fixture.opportunityId, { status: "pursuing" });
    const prepared = await ensurePursuitSnapshotPrepared(fixture.opportunityId);
    const { store, objects } = memoryArtifactStore();
    const retriever = fixtureRetriever(
      new Map(fixture.documents.map((document) => [document.key, document.bytes])),
    );

    const first = await processPursuitSnapshot(prepared.id, {
      retriever,
      artifactStore: store,
      tempRoot,
      maxDocumentBytes: 1024 * 1024,
      maxSnapshotBytes: 4 * 1024 * 1024,
    });
    const second = await processPursuitSnapshot(prepared.id, {
      retriever,
      artifactStore: store,
      tempRoot,
      maxDocumentBytes: 1024 * 1024,
      maxSnapshotBytes: 4 * 1024 * 1024,
    });

    assert.equal(first.status, "complete");
    assert.equal(second.status, "complete");
    assert.equal(objects.size, 2);

    await closeDb();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [{ artifacts, links, storedBytes }] = await sql<{
        artifacts: number;
        links: number;
        storedBytes: number;
      }[]>`
        SELECT
          (SELECT count(*)::int FROM source_binary_artifacts) AS artifacts,
          (SELECT count(*)::int FROM pursuit_snapshot_documents psd
            JOIN pursuit_document_snapshots pds ON pds.id = psd.pursuit_snapshot_id
            WHERE pds.opportunity_id = ${fixture.opportunityId}) AS links,
          (SELECT coalesce(sum(byte_count), 0)::int FROM source_binary_artifacts) AS "storedBytes"
      `;
      assert.equal(artifacts, 2);
      assert.equal(links, 2);
      assert.equal(storedBytes, Buffer.byteLength("solicitation-v1") + Buffer.byteLength("pricing-v1"));
    } finally {
      await sql.end({ timeout: 5 });
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await cleanup(fixture.sourceRecordId);
  }
});

test("a changed amendment creates a new immutable snapshot generation and preserves the prior artifact", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  const tempRoot = await mkdtemp(join(tmpdir(), "govtract-snapshot-amendment-"));
  try {
    await saveOpportunity({ opportunityId: fixture.opportunityId });
    await updateSavedOpportunity(fixture.opportunityId, { status: "pursuing" });
    const firstPrepared = await ensurePursuitSnapshotPrepared(fixture.opportunityId);
    const { store, objects } = memoryArtifactStore();
    await processPursuitSnapshot(firstPrepared.id, {
      retriever: fixtureRetriever(new Map(fixture.documents.map((document) => [document.key, document.bytes]))),
      artifactStore: store,
      tempRoot,
      maxDocumentBytes: 1024 * 1024,
      maxSnapshotBytes: 4 * 1024 * 1024,
    });

    await closeDb();
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const [pricing] = await sql<{ id: string }[]>`
        SELECT id FROM opportunity_documents
        WHERE opportunity_id = ${fixture.opportunityId}
          AND name = 'Pricing.xlsx'
      `;
      await sql`
        INSERT INTO opportunity_document_versions (
          opportunity_document_id, version_number, fingerprint, checksum_sha256,
          retrieved_at, name, mime_type, file_size_bytes, is_amendment, amendment_label, source_metadata
        ) VALUES (
          ${pricing!.id}, 2, ${sha256("pricing-amendment-metadata")}, ${sha256("pricing-v2")},
          now(), 'Pricing Amendment 1.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ${Buffer.byteLength("pricing-v2")}, true, 'Amendment 1', '{}'::jsonb
        )
      `;
    } finally {
      await sql.end({ timeout: 5 });
    }

    const secondPrepared = await ensurePursuitSnapshotPrepared(fixture.opportunityId);
    assert.notEqual(secondPrepared.id, firstPrepared.id);
    await processPursuitSnapshot(secondPrepared.id, {
      retriever: fixtureRetriever(
        new Map([
          [fixture.documents[0]!.key, "solicitation-v1"],
          [fixture.documents[1]!.key, "pricing-v2"],
        ]),
      ),
      artifactStore: store,
      tempRoot,
      maxDocumentBytes: 1024 * 1024,
      maxSnapshotBytes: 4 * 1024 * 1024,
    });

    assert.equal(objects.size, 3);
    await closeDb();
    const verification = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
    try {
      const snapshots = await verification<{ id: string; status: string }[]>`
        SELECT id, status FROM pursuit_document_snapshots
        WHERE opportunity_id = ${fixture.opportunityId}
        ORDER BY created_at ASC
      `;
      assert.equal(snapshots.length, 2);
      assert.deepEqual(snapshots.map((snapshot) => snapshot.status), ["complete", "complete"]);
      const [{ count: oldLinks }] = await verification<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM pursuit_snapshot_documents
        WHERE pursuit_snapshot_id = ${firstPrepared.id}
          AND source_binary_artifact_id IS NOT NULL
      `;
      assert.equal(oldLinks, 2);
    } finally {
      await verification.end({ timeout: 5 });
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await cleanup(fixture.sourceRecordId);
  }
});

test("auth-blocked files are explicit and mark the pursuit snapshot blocked instead of silently omitting files", { skip: !canRun }, async () => {
  const fixture = await seedOpportunity();
  const tempRoot = await mkdtemp(join(tmpdir(), "govtract-snapshot-blocked-"));
  try {
    await saveOpportunity({ opportunityId: fixture.opportunityId });
    await updateSavedOpportunity(fixture.opportunityId, { status: "pursuing" });
    const prepared = await ensurePursuitSnapshotPrepared(fixture.opportunityId);
    const { store } = memoryArtifactStore();
    const result = await processPursuitSnapshot(prepared.id, {
      retriever: fixtureRetriever(
        new Map<string, string | SnapshotRetrievalError>([
          [fixture.documents[0]!.key, fixture.documents[0]!.bytes],
          [fixture.documents[1]!.key, new SnapshotRetrievalError("auth_blocked", "Supplier session expired")],
        ]),
      ),
      artifactStore: store,
      tempRoot,
      maxDocumentBytes: 1024 * 1024,
      maxSnapshotBytes: 4 * 1024 * 1024,
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.blocked, 1);
    const latest = await getLatestPursuitSnapshot(fixture.opportunityId);
    assert.equal(latest?.status, "blocked");
    assert.equal(latest?.documents.filter((document) => document.status === "blocked").length, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await cleanup(fixture.sourceRecordId);
  }
});
