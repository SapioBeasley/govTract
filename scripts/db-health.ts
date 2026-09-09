import { closeDb } from "../lib/db/client";
import { checkDatabase } from "../lib/db/health";

async function main() {
  const result = await checkDatabase();
  console.log(`Database connection OK (${result.latencyMs} ms)`);
}

main()
  .catch((error) => {
    console.error("Database connection failed:", error);
    process.exitCode = 1;
  })
  .finally(closeDb);
