import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { companyProfiles } from "@/lib/db/canonical-schema";

export type CompanyProfileInput = {
  name: string;
  legalName?: string | null;
  description?: string | null;
  uei?: string | null;
  cageCode?: string | null;
  websiteUrl?: string | null;
  productsServices?: string[];
  capabilities?: string[];
  preferredIndustries?: string[];
  preferredKeywords?: string[];
  excludedKeywords?: string[];
  serviceAreas?: string[];
  preferredContractMin?: number | null;
  preferredContractMax?: number | null;
  naicsCodes?: string[];
  certifications?: string[];
  statuses?: string[];
  licenses?: string[];
  governmentRegistrations?: string[];
  pastPerformance?: string[];
};

export type CompanyProfile = Required<
  Omit<
    CompanyProfileInput,
    | "legalName"
    | "description"
    | "uei"
    | "cageCode"
    | "websiteUrl"
    | "preferredContractMin"
    | "preferredContractMax"
  >
> & {
  id: string;
  legalName: string | null;
  description: string | null;
  uei: string | null;
  cageCode: string | null;
  websiteUrl: string | null;
  preferredContractMin: number | null;
  preferredContractMax: number | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export class CompanyProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyProfileValidationError";
  }
}

type StoredCompanyProfile = typeof companyProfiles.$inferSelect;

function cleanOptionalText(value: string | null | undefined, maxLength: number) {
  if (value === null || value === undefined) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (cleaned.length > maxLength) {
    throw new CompanyProfileValidationError(`Value cannot exceed ${maxLength} characters.`);
  }
  return cleaned;
}

function cleanList(values: string[] | undefined, options?: { maxItems?: number; maxLength?: number }) {
  const maxItems = options?.maxItems ?? 100;
  const maxLength = options?.maxLength ?? 500;
  if (!values) return [];

  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") {
      throw new CompanyProfileValidationError("List values must be text.");
    }
    const cleaned = value.trim();
    if (!cleaned) continue;
    if (cleaned.length > maxLength) {
      throw new CompanyProfileValidationError(`List values cannot exceed ${maxLength} characters.`);
    }
    const key = cleaned.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length > maxItems) {
      throw new CompanyProfileValidationError(`A list cannot contain more than ${maxItems} values.`);
    }
  }
  return result;
}

function cleanMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new CompanyProfileValidationError("Preferred contract values must be non-negative numbers.");
  }
  return Math.round(value * 100) / 100;
}

function cleanWebsite(value: string | null | undefined) {
  const cleaned = cleanOptionalText(value, 2048);
  if (!cleaned) return null;
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new CompanyProfileValidationError("Website must be a valid http or https URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CompanyProfileValidationError("Website must be a valid http or https URL.");
  }
  return parsed.toString();
}

export function normalizeCompanyProfileInput(input: CompanyProfileInput): CompanyProfileInput & {
  name: string;
  legalName: string | null;
  description: string | null;
  uei: string | null;
  cageCode: string | null;
  websiteUrl: string | null;
  productsServices: string[];
  capabilities: string[];
  preferredIndustries: string[];
  preferredKeywords: string[];
  excludedKeywords: string[];
  serviceAreas: string[];
  preferredContractMin: number | null;
  preferredContractMax: number | null;
  naicsCodes: string[];
  certifications: string[];
  statuses: string[];
  licenses: string[];
  governmentRegistrations: string[];
  pastPerformance: string[];
} {
  const name = cleanOptionalText(input.name, 300);
  if (!name) throw new CompanyProfileValidationError("Company name is required.");

  const preferredContractMin = cleanMoney(input.preferredContractMin);
  const preferredContractMax = cleanMoney(input.preferredContractMax);
  if (
    preferredContractMin !== null &&
    preferredContractMax !== null &&
    preferredContractMin > preferredContractMax
  ) {
    throw new CompanyProfileValidationError(
      "Preferred minimum contract value cannot exceed the maximum contract value.",
    );
  }

  return {
    name,
    legalName: cleanOptionalText(input.legalName, 300),
    description: cleanOptionalText(input.description, 10_000),
    uei: cleanOptionalText(input.uei, 50),
    cageCode: cleanOptionalText(input.cageCode, 50),
    websiteUrl: cleanWebsite(input.websiteUrl),
    productsServices: cleanList(input.productsServices),
    capabilities: cleanList(input.capabilities),
    preferredIndustries: cleanList(input.preferredIndustries),
    preferredKeywords: cleanList(input.preferredKeywords),
    excludedKeywords: cleanList(input.excludedKeywords),
    serviceAreas: cleanList(input.serviceAreas),
    preferredContractMin,
    preferredContractMax,
    naicsCodes: cleanList(input.naicsCodes, { maxItems: 100, maxLength: 20 }),
    certifications: cleanList(input.certifications),
    statuses: cleanList(input.statuses),
    licenses: cleanList(input.licenses),
    governmentRegistrations: cleanList(input.governmentRegistrations),
    pastPerformance: cleanList(input.pastPerformance, { maxItems: 50, maxLength: 4_000 }),
  };
}

function stringArrayFrom(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function nullableNumberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fromStored(row: StoredCompanyProfile): CompanyProfile {
  const serviceAreas = row.serviceAreas ?? {};
  const qualifications = row.qualifications ?? {};
  const metadata = row.metadata ?? {};

  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    description: typeof metadata.description === "string" ? metadata.description : null,
    uei: row.uei,
    cageCode: row.cageCode,
    websiteUrl: row.websiteUrl,
    productsServices: stringArrayFrom(metadata.productsServices),
    capabilities: row.capabilities,
    preferredIndustries: stringArrayFrom(metadata.preferredIndustries),
    preferredKeywords: stringArrayFrom(metadata.preferredKeywords),
    excludedKeywords: stringArrayFrom(metadata.excludedKeywords),
    serviceAreas: stringArrayFrom(serviceAreas.locations),
    preferredContractMin: nullableNumberFrom(metadata.preferredContractMin),
    preferredContractMax: nullableNumberFrom(metadata.preferredContractMax),
    naicsCodes: row.naicsCodes,
    certifications: stringArrayFrom(qualifications.certifications),
    statuses: stringArrayFrom(qualifications.statuses),
    licenses: stringArrayFrom(qualifications.licenses),
    governmentRegistrations: stringArrayFrom(qualifications.governmentRegistrations),
    pastPerformance: stringArrayFrom(metadata.pastPerformance),
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadDefaultStoredProfile() {
  const db = getDb();
  const [row] = await db
    .select()
    .from(companyProfiles)
    .where(eq(companyProfiles.isDefault, true))
    .orderBy(desc(companyProfiles.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function getDefaultCompanyProfile(): Promise<CompanyProfile | null> {
  const stored = await loadDefaultStoredProfile();
  return stored ? fromStored(stored) : null;
}

export async function saveDefaultCompanyProfile(input: CompanyProfileInput): Promise<CompanyProfile> {
  const normalized = normalizeCompanyProfileInput(input);
  const db = getDb();
  const existing = await loadDefaultStoredProfile();

  const serviceAreas = {
    ...(existing?.serviceAreas ?? {}),
    locations: normalized.serviceAreas,
  };
  const qualifications = {
    ...(existing?.qualifications ?? {}),
    certifications: normalized.certifications,
    statuses: normalized.statuses,
    licenses: normalized.licenses,
    governmentRegistrations: normalized.governmentRegistrations,
  };
  const metadata = {
    ...(existing?.metadata ?? {}),
    description: normalized.description,
    productsServices: normalized.productsServices,
    preferredIndustries: normalized.preferredIndustries,
    preferredKeywords: normalized.preferredKeywords,
    excludedKeywords: normalized.excludedKeywords,
    preferredContractMin: normalized.preferredContractMin,
    preferredContractMax: normalized.preferredContractMax,
    pastPerformance: normalized.pastPerformance,
  };

  if (existing) {
    const [updated] = await db
      .update(companyProfiles)
      .set({
        name: normalized.name,
        legalName: normalized.legalName,
        uei: normalized.uei,
        cageCode: normalized.cageCode,
        websiteUrl: normalized.websiteUrl,
        capabilities: normalized.capabilities,
        naicsCodes: normalized.naicsCodes,
        serviceAreas,
        qualifications,
        metadata,
        isDefault: true,
        updatedAt: new Date(),
      })
      .where(eq(companyProfiles.id, existing.id))
      .returning();

    if (!updated) throw new Error("Company profile could not be updated.");
    return fromStored(updated);
  }

  const [created] = await db
    .insert(companyProfiles)
    .values({
      name: normalized.name,
      legalName: normalized.legalName,
      uei: normalized.uei,
      cageCode: normalized.cageCode,
      websiteUrl: normalized.websiteUrl,
      capabilities: normalized.capabilities,
      naicsCodes: normalized.naicsCodes,
      serviceAreas,
      qualifications,
      metadata,
      isDefault: true,
    })
    .returning();

  if (!created) throw new Error("Company profile could not be created.");
  return fromStored(created);
}
