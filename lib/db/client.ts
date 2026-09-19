import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as canonicalSchema from "./canonical-schema";
import * as bidDraftGenerationsSchema from "./bid-draft-generations-schema";
import * as coreSchema from "./schema";
import * as documentExtractionSchema from "./document-extractions-schema";
import * as historicalProcurementSchema from "./historical-procurement-schema";
import * as pursuitSnapshotSchema from "./pursuit-snapshots-schema";
import * as savedOpportunitySchema from "./saved-opportunities-schema";
import * as solicitationRequirementSchema from "./solicitation-requirements-schema";
import * as solicitationUnderstandingSchema from "./solicitation-understandings-schema";
import * as sourceConnectionSchema from "./source-connections-schema";

const schema = {
  ...coreSchema,
  ...canonicalSchema,
  ...bidDraftGenerationsSchema,
  ...documentExtractionSchema,
  ...historicalProcurementSchema,
  ...pursuitSnapshotSchema,
  ...savedOpportunitySchema,
  ...solicitationRequirementSchema,
  ...solicitationUnderstandingSchema,
  ...sourceConnectionSchema,
};

let sqlClient: ReturnType<typeof postgres> | null = null;

export function resolveDatabasePoolMax(raw: string | undefined) {
  if (!raw) return 1;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 32);
}

function createDatabase(databaseUrl: string) {
  sqlClient = postgres(databaseUrl, {
    max: resolveDatabasePoolMax(process.env.DATABASE_POOL_MAX),
    prepare: false,
    idle_timeout: 20,
  });
  return drizzle(sqlClient, { schema });
}

let database: ReturnType<typeof createDatabase> | null = null;

export function getDb() {
  if (database) return database;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database-backed ingestion");
  }

  database = createDatabase(databaseUrl);
  return database;
}

export async function closeDb() {
  if (!sqlClient) return;
  await sqlClient.end({ timeout: 5 });
  sqlClient = null;
  database = null;
}
