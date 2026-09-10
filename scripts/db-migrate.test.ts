import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyLegacyMigrationState,
  legacyMigrationRequirements,
} from "./db-migrate-helpers";

test("classifies an absent legacy migration when no schema markers exist", () => {
  assert.equal(classifyLegacyMigrationState([false, false, false]), "absent");
});

test("classifies a present legacy migration only when every schema marker exists", () => {
  assert.equal(classifyLegacyMigrationState([true, true, true]), "present");
});

test("classifies a partial legacy migration instead of silently baselining it", () => {
  assert.equal(classifyLegacyMigrationState([true, false, true]), "partial");
});

test("defines deterministic baseline requirements for every existing migration", () => {
  assert.deepEqual(Object.keys(legacyMigrationRequirements), [
    "0000_ingestion_foundation.sql",
    "0001_document_versioning.sql",
    "0002_source_connections.sql",
    "0003_document_extractions.sql",
    "0004_canonical_procurement_model.sql",
  ]);

  for (const requirements of Object.values(legacyMigrationRequirements)) {
    assert.ok(requirements.length > 0);
  }
});
