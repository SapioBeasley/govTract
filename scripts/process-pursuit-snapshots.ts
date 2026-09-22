import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";

import { closeDb, getDb } from "../lib/db/client";
import { savedOpportunities } from "../lib/db/saved-opportunities-schema";
import { bidWorkspaces } from "../lib/db/canonical-schema";
import { opportunities } from "../lib/db/schema";
import { createVercelBlobSnapshotArtifactStore } from "../lib/procurement/pursuits/artifact-store";
import { createBeaconPursuitDocumentRetriever } from "../lib/procurement/pursuits/beacon-retriever";
import { listPursuitSnapshotWork } from "../lib/procurement/pursuits/work-queue";
import {
  ensurePursuitSnapshotPrepared,
  ensureBidWorkspaceSnapshotPrepared,
  getPursuitSnapshot,
  processPursuitSnapshot,
} from "../lib/procurement/pursuits/snapshot";

const LIMIT = Math.max(1, Math.min(50, Number(process.env.PURSUIT_SNAPSHOT_LIMIT ?? "10")));
const SOURCE = (process.env.PURSUIT_SNAPSHOT_SOURCE ?? "beacon").trim().toLowerCase();
const MAX_DOCUMENT_BYTES = Math.max(
  1,
  Number(process.env.PURSUIT_SNAPSHOT_MAX_DOCUMENT_BYTES ?? String(300 * 1024 * 1024)),
);
const MAX_SNAPSHOT_BYTES = Math.max(
  1,
  Number(process.env.PURSUIT_SNAPSHOT_MAX_TOTAL_BYTES ?? String(1024 * 1024 * 1024)),
);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for pursuit snapshots");
  if (!SOURCE) throw new Error("PURSUIT_SNAPSHOT_SOURCE must not be blank");
  if (!Number.isFinite(LIMIT) || !Number.isFinite(MAX_DOCUMENT_BYTES) || !Number.isFinite(MAX_SNAPSHOT_BYTES)) {
    throw new Error("Pursuit snapshot limits must be finite numbers");
  }

  const db = getDb();
  // Process pending workspace-owned snapshots first. Saved-only sweeps previously
  // kept selecting the same oldest complete pursuits and starved new bid requests.
  const queued = await listPursuitSnapshotWork(SOURCE,LIMIT);
  const pursuits = queued.length < LIMIT ? await db
    .select({ opportunityId: savedOpportunities.opportunityId })
    .from(savedOpportunities)
    .innerJoin(opportunities, eq(opportunities.id, savedOpportunities.opportunityId))
    .where(
      and(
        eq(savedOpportunities.status, "pursuing"),
        eq(opportunities.source, SOURCE),
      ),
    )
    .orderBy(desc(savedOpportunities.updatedAt))
    .limit(LIMIT - queued.length) : [];

  const retriever = createBeaconPursuitDocumentRetriever();
  const artifactStore = createVercelBlobSnapshotArtifactStore();
  const tempRoot = await mkdtemp(join(tmpdir(), "govtract-pursuit-snapshots-"));
  let complete = 0;
  let blocked = 0;
  let incomplete = 0;
  let errors = 0;

  const selected = [...queued.map((row) => ({ opportunityId: row.opportunityId!, snapshotId: row.snapshotId })),
    ...pursuits.filter((row) => !queued.some((item) => item.opportunityId === row.opportunityId))
      .map((row) => ({ opportunityId: row.opportunityId, snapshotId: null }))].slice(0,LIMIT);
  try {
    for (const pursuit of selected) {
      try {
        const previous = pursuit.snapshotId
          ? await getPursuitSnapshot(pursuit.snapshotId)
          : await ensurePursuitSnapshotPrepared(pursuit.opportunityId);
        if (!previous) throw new Error("Pending pursuit snapshot was not found");
        // An authoritative eBid form or addendum can appear after the original
        // workspace was created. Prepare its own *new* immutable snapshot with
        // the current source inventory, without modifying old evidence or AI.
        const [workspace] = await db.select({id:bidWorkspaces.id})
          .from(bidWorkspaces)
          .where(and(
            eq(bidWorkspaces.opportunityId,pursuit.opportunityId),
            isNull(bidWorkspaces.companyProfileId),
          )).limit(1);
        const snapshot = workspace
          ? await ensureBidWorkspaceSnapshotPrepared(workspace.id)
          : previous;
        const result = await processPursuitSnapshot(snapshot.id, {
          retriever,
          artifactStore,
          tempRoot,
          maxDocumentBytes: MAX_DOCUMENT_BYTES,
          maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
        });
        if (result.status === "complete") complete += 1;
        else if (result.status === "blocked") blocked += 1;
        else incomplete += 1;
        console.log(
          `PURSUIT_SNAPSHOT opportunity=${pursuit.opportunityId} snapshot=${snapshot.id} source=${SOURCE} status=${result.status} stored=${result.stored} blocked=${result.blocked} failed=${result.failed}`,
        );
      } catch (error) {
        errors += 1;
        console.error(
          `PURSUIT_SNAPSHOT_ERROR opportunity=${pursuit.opportunityId} source=${SOURCE} message=${JSON.stringify(error instanceof Error ? error.message.slice(0, 300) : "unknown")}`,
        );
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    await closeDb();
  }

  console.log(
    `PURSUIT_SNAPSHOT_SUMMARY source=${SOURCE} selected=${selected.length} complete=${complete} blocked=${blocked} incomplete=${incomplete} errors=${errors}`,
  );
  if (errors > 0) process.exitCode = 1;
}

void main().catch(async (error) => {
  console.error(
    `PURSUIT_SNAPSHOT_FATAL ${JSON.stringify(error instanceof Error ? error.message.slice(0, 500) : "unknown")}`,
  );
  await closeDb().catch(() => undefined);
  process.exitCode = 1;
});
