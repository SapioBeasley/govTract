import { sql } from "drizzle-orm";
import { getDb } from "./client";

export async function checkDatabase() {
  const startedAt = Date.now();
  await getDb().execute(sql`select 1 as ok`);

  return {
    status: "ok" as const,
    latencyMs: Date.now() - startedAt,
  };
}
