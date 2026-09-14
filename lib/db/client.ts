import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as canonicalSchema from "./canonical-schema";
import * as coreSchema from "./schema";
import * as documentExtractionSchema from "./document-extractions-schema";
import * as solicitationRequirementSchema from "./solicitation-requirements-schema";
import * as solicitationUnderstandingSchema from "./solicitation-understandings-schema";
import * as sourceConnectionSchema from "./source-connections-schema";

const schema = {
  ...coreSchema,
  ...canonicalSchema,
  ...documentExtractionSchema,
  ...solicitationRequirementSchema,
  ...solicitationUnderstandingSchema,
  ...sourceConnectionSchema,
};

let sqlClient: ReturnType<typeof postgres> | null = null;

function createDatabase(databaseUrl: string) {
  sqlClient = postgres(databaseUrl, {
    max: 1,
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
