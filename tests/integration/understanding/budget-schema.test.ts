import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

const canRun = Boolean(process.env.DATABASE_URL);

test(
  "understanding schema persists completeness, budget traceability, and reusable chunk state",
  { skip: !canRun },
  async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

    try {
      const columns = await sql<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solicitation_understandings'
      `;
      const names = new Set(columns.map((column) => column.column_name));

      for (const expected of [
        "completeness_status",
        "incomplete_reason",
        "coverage_metadata",
        "budget_microusd",
        "pricing_profile_version",
      ]) {
        assert.equal(names.has(expected), true, `missing ${expected}`);
      }

      const [chunkTable] = await sql<{ chunks: string | null }[]>`
        SELECT to_regclass('public.solicitation_understanding_chunks')::text AS chunks
      `;
      assert.equal(chunkTable?.chunks, "solicitation_understanding_chunks");

      const chunkColumns = await sql<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solicitation_understanding_chunks'
      `;
      const chunkNames = new Set(chunkColumns.map((column) => column.column_name));
      for (const expected of [
        "chunk_key",
        "input_fingerprint",
        "status",
        "char_count",
        "estimated_input_token_count",
        "output_token_count",
        "estimated_cost_microusd",
        "actual_cost_microusd",
        "pricing_profile_version",
        "structured_output",
        "skip_reason",
      ]) {
        assert.equal(chunkNames.has(expected), true, `missing chunk column ${expected}`);
      }

      const [defaults] = await sql<{
        completeness_default: string | null;
        budget_default: string | null;
      }[]>`
        SELECT
          MAX(column_default) FILTER (WHERE column_name = 'completeness_status') AS completeness_default,
          MAX(column_default) FILTER (WHERE column_name = 'budget_microusd') AS budget_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'solicitation_understandings'
      `;
      assert.match(defaults?.completeness_default ?? "", /partial/);
      assert.match(defaults?.budget_default ?? "", /0/);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);
