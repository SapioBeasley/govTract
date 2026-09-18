import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

import { closeDb } from "@/lib/db/client";
import {
  getDefaultCompanyProfile,
  normalizeCompanyProfileInput,
  saveDefaultCompanyProfile,
} from "@/lib/company/profile";

const canRun = Boolean(process.env.DATABASE_URL);

const completeInput = {
  name: "Acme Field Services",
  legalName: "Acme Field Services LLC",
  description: "Houston contractor providing field services and light industrial support.",
  uei: "ABCDEF123456",
  cageCode: "1A2B3",
  websiteUrl: "https://example.com",
  productsServices: ["Pump maintenance", "Field inspection"],
  capabilities: ["24/7 response", "Preventive maintenance"],
  preferredIndustries: ["Water utilities", "Public works"],
  preferredKeywords: ["pump", "maintenance"],
  excludedKeywords: ["medical"],
  serviceAreas: ["Houston", "Harris County", "Texas"],
  preferredContractMin: 25000,
  preferredContractMax: 750000,
  naicsCodes: ["811310", "237110"],
  certifications: ["SBE"],
  statuses: ["Texas HUB"],
  licenses: ["Texas Electrical Contractor"],
  governmentRegistrations: ["SAM.gov active"],
  pastPerformance: [
    "Performed preventive maintenance for a municipal water system.",
    "Completed emergency pump repairs for a public utility.",
  ],
};

test("company profile normalization trims, deduplicates, and preserves evaluation inputs", () => {
  const normalized = normalizeCompanyProfileInput({
    ...completeInput,
    name: "  Acme Field Services  ",
    capabilities: ["24/7 response", "24/7 response", " Preventive maintenance "],
    naicsCodes: ["811310", "811310", "237110"],
    serviceAreas: [" Houston ", "Houston", "Texas"],
  });

  assert.equal(normalized.name, "Acme Field Services");
  assert.deepEqual(normalized.capabilities, ["24/7 response", "Preventive maintenance"]);
  assert.deepEqual(normalized.naicsCodes, ["811310", "237110"]);
  assert.deepEqual(normalized.serviceAreas, ["Houston", "Texas"]);
  assert.equal(normalized.preferredContractMin, 25000);
  assert.equal(normalized.preferredContractMax, 750000);
});

test("company profile rejects missing names and inverted contract ranges", () => {
  assert.throws(
    () => normalizeCompanyProfileInput({ ...completeInput, name: "   " }),
    /Company name is required/,
  );
  assert.throws(
    () =>
      normalizeCompanyProfileInput({
        ...completeInput,
        preferredContractMin: 900000,
        preferredContractMax: 100000,
      }),
    /minimum contract value cannot exceed the maximum/i,
  );
});

test("default company profile persists all issue 29 fields and updates one record", { skip: !canRun }, async () => {
  await closeDb();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await sql`DELETE FROM company_profiles WHERE name LIKE 'Company profile test %'`;
  } finally {
    await sql.end({ timeout: 5 });
  }

  const suffix = `${process.pid}-${Date.now()}`;
  const first = await saveDefaultCompanyProfile({
    ...completeInput,
    name: `Company profile test ${suffix}`,
  });

  const updated = await saveDefaultCompanyProfile({
    ...completeInput,
    name: `Company profile test ${suffix}`,
    preferredKeywords: ["pump", "maintenance", "inspection"],
    preferredContractMax: 1000000,
    pastPerformance: ["Updated municipal reference."],
  });

  assert.equal(updated.id, first.id);
  assert.equal(updated.isDefault, true);
  assert.deepEqual(updated.productsServices, completeInput.productsServices);
  assert.deepEqual(updated.preferredIndustries, completeInput.preferredIndustries);
  assert.deepEqual(updated.preferredKeywords, ["pump", "maintenance", "inspection"]);
  assert.deepEqual(updated.excludedKeywords, completeInput.excludedKeywords);
  assert.deepEqual(updated.serviceAreas, completeInput.serviceAreas);
  assert.equal(updated.preferredContractMin, 25000);
  assert.equal(updated.preferredContractMax, 1000000);
  assert.deepEqual(updated.naicsCodes, completeInput.naicsCodes);
  assert.deepEqual(updated.certifications, completeInput.certifications);
  assert.deepEqual(updated.statuses, completeInput.statuses);
  assert.deepEqual(updated.licenses, completeInput.licenses);
  assert.deepEqual(updated.governmentRegistrations, completeInput.governmentRegistrations);
  assert.deepEqual(updated.pastPerformance, ["Updated municipal reference."]);

  const loaded = await getDefaultCompanyProfile();
  assert.equal(loaded?.id, first.id);
  assert.equal(loaded?.description, completeInput.description);

  await closeDb();
  const cleanupSql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await cleanupSql`DELETE FROM company_profiles WHERE id = ${first.id}`;
  } finally {
    await cleanupSql.end({ timeout: 5 });
  }
});
