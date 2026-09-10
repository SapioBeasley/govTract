import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

import {
  classifyLegacyMigrationState,
  formatLegacyMigrationRequirement,
  legacyMigrationRequirements,
  type LegacyMigrationRequirement,
} from "./db-migrate-helpers";

const migrationsDir = resolve(process.cwd(), "drizzle");
const allowLegacyBaseline = process.argv.includes("--baseline-existing");

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run database migrations");
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
  });

  async function requirementExists(requirement: LegacyMigrationRequirement) {
    if (requirement.kind === "table") {
      const [row] = await sql<{ exists: boolean }[]>`
        SELECT to_regclass(${`public.${requirement.name}`}) IS NOT NULL AS exists
      `;
      return row?.exists ?? false;
    }

    const [row] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${requirement.table}
          AND column_name = ${requirement.column}
      ) AS exists
    `;
    return row?.exists ?? false;
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS public.govtract_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const migrationFiles = (await readdir(migrationsDir))
      .filter((file) => /^\d+.*\.sql$/.test(file))
      .sort();

    if (migrationFiles.length === 0) {
      console.log("No database migrations found.");
      return;
    }

    for (const version of migrationFiles) {
      const migrationSql = await readFile(resolve(migrationsDir, version), "utf8");
      const checksum = createHash("sha256").update(migrationSql).digest("hex");
      const existing = await sql<{ checksum: string }[]>`
        SELECT checksum
        FROM public.govtract_migrations
        WHERE version = ${version}
      `;

      if (existing.length > 0) {
        if (existing[0].checksum !== checksum) {
          throw new Error(
            `Migration ${version} has changed after it was applied. Add a new migration instead.`,
          );
        }

        console.log(`Already applied: ${version}`);
        continue;
      }

      const requirements = legacyMigrationRequirements[version];
      if (allowLegacyBaseline && requirements) {
        const requirementResults: boolean[] = [];
        for (const requirement of requirements) {
          requirementResults.push(await requirementExists(requirement));
        }

        const state = classifyLegacyMigrationState(requirementResults);
        if (state === "partial") {
          const missing = requirements
            .filter((_, index) => !requirementResults[index])
            .map(formatLegacyMigrationRequirement)
            .join(", ");
          throw new Error(
            `Migration ${version} appears partially applied; refusing to baseline. Missing schema markers: ${missing}`,
          );
        }

        if (state === "present") {
          await sql`
            INSERT INTO public.govtract_migrations (version, checksum)
            VALUES (${version}, ${checksum})
          `;
          console.log(`Baselined existing: ${version}`);
          continue;
        }
      }

      await sql.begin(async (tx) => {
        await tx.unsafe(migrationSql);
        await tx`
          INSERT INTO public.govtract_migrations (version, checksum)
          VALUES (${version}, ${checksum})
        `;
      });

      console.log(`Applied: ${version}`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});
