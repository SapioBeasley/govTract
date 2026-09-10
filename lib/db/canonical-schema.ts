import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { opportunities, sourceRecords } from "./schema";

const jsonObject = sql`'{}'::jsonb`;
const emptyTextArray = sql`ARRAY[]::text[]`;

export const agencies = pgTable(
  "agencies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    slug: text("slug").notNull().unique(),
    agencyType: text("agency_type"),
    jurisdiction: text("jurisdiction"),
    websiteUrl: text("website_url"),
    uei: text("uei"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agencies_name_idx").on(table.canonicalName),
    index("agencies_type_jurisdiction_idx").on(table.agencyType, table.jurisdiction),
    index("agencies_uei_idx").on(table.uei),
  ],
);

export const opportunitySourceRecords = pgTable(
  "opportunity_source_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    agencyId: uuid("agency_id").references(() => agencies.id, { onDelete: "set null" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    linkMethod: text("link_method").notNull().default("direct"),
    confidence: integer("confidence"),
    sourceAuthority: text("source_authority").notNull().default("unknown"),
    normalizedPayload: jsonb("normalized_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonObject),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("opportunity_source_records_source_record_uidx").on(table.sourceRecordId),
    uniqueIndex("opportunity_source_records_opportunity_source_uidx").on(
      table.opportunityId,
      table.sourceRecordId,
    ),
    index("opportunity_source_records_opportunity_primary_idx").on(
      table.opportunityId,
      table.isPrimary,
    ),
    index("opportunity_source_records_agency_idx").on(table.agencyId),
  ],
);

export const vendors = pgTable(
  "vendors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canonicalName: text("canonical_name").notNull(),
    legalName: text("legal_name"),
    uei: text("uei"),
    cageCode: text("cage_code"),
    duns: text("duns"),
    websiteUrl: text("website_url"),
    location: jsonb("location").$type<Record<string, unknown>>().notNull().default(jsonObject),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("vendors_uei_uidx").on(table.uei),
    index("vendors_name_idx").on(table.canonicalName),
    index("vendors_cage_code_idx").on(table.cageCode),
  ],
);

export const awards = pgTable(
  "awards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agencyId: uuid("agency_id").references(() => agencies.id, { onDelete: "set null" }),
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    awardNumber: text("award_number"),
    piid: text("piid"),
    parentAwardNumber: text("parent_award_number"),
    title: text("title"),
    description: text("description"),
    awardType: text("award_type"),
    amount: numeric("amount", { precision: 20, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    awardedAt: timestamp("awarded_at", { withTimezone: true }),
    periodStartAt: timestamp("period_start_at", { withTimezone: true }),
    periodEndAt: timestamp("period_end_at", { withTimezone: true }),
    placeOfPerformance: jsonb("place_of_performance")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("awards_agency_awarded_idx").on(table.agencyId, table.awardedAt),
    index("awards_vendor_awarded_idx").on(table.vendorId, table.awardedAt),
    index("awards_award_number_idx").on(table.awardNumber),
    index("awards_piid_idx").on(table.piid),
  ],
);

export const awardSourceRecords = pgTable(
  "award_source_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    awardId: uuid("award_id")
      .notNull()
      .references(() => awards.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    linkMethod: text("link_method").notNull().default("direct"),
    confidence: integer("confidence"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("award_source_records_source_record_uidx").on(table.sourceRecordId),
    uniqueIndex("award_source_records_award_source_uidx").on(table.awardId, table.sourceRecordId),
    index("award_source_records_award_idx").on(table.awardId),
  ],
);

export const opportunityAwardRelationships = pgTable(
  "opportunity_award_relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    awardId: uuid("award_id")
      .notNull()
      .references(() => awards.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    method: text("method").notNull(),
    confidence: integer("confidence"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonObject),
    isDerived: boolean("is_derived").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("opportunity_award_relationships_uidx").on(
      table.opportunityId,
      table.awardId,
      table.relationshipType,
    ),
    index("opportunity_award_relationships_opportunity_idx").on(table.opportunityId),
    index("opportunity_award_relationships_award_idx").on(table.awardId),
  ],
);

export const intelligenceFindings = pgTable(
  "intelligence_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
      onDelete: "cascade",
    }),
    awardId: uuid("award_id").references(() => awards.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    findingType: text("finding_type").notNull(),
    summary: text("summary").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default(jsonObject),
    confidence: integer("confidence"),
    derivationMethod: text("derivation_method").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonObject),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("intelligence_findings_opportunity_type_idx").on(
      table.opportunityId,
      table.findingType,
    ),
    index("intelligence_findings_award_type_idx").on(table.awardId, table.findingType),
    index("intelligence_findings_vendor_type_idx").on(table.vendorId, table.findingType),
  ],
);

export const companyProfiles = pgTable(
  "company_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    uei: text("uei"),
    cageCode: text("cage_code"),
    websiteUrl: text("website_url"),
    capabilities: text("capabilities").array().notNull().default(emptyTextArray),
    naicsCodes: text("naics_codes").array().notNull().default(emptyTextArray),
    pscCodes: text("psc_codes").array().notNull().default(emptyTextArray),
    serviceAreas: jsonb("service_areas").$type<Record<string, unknown>>().notNull().default(jsonObject),
    qualifications: jsonb("qualifications")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonObject),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("company_profiles_default_idx").on(table.isDefault),
    index("company_profiles_name_idx").on(table.name),
  ],
);

export const opportunityMatches = pgTable(
  "opportunity_matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    companyProfileId: uuid("company_profile_id")
      .notNull()
      .references(() => companyProfiles.id, { onDelete: "cascade" }),
    score: integer("score"),
    status: text("status").notNull().default("unreviewed"),
    reasons: jsonb("reasons").$type<Record<string, unknown>>().notNull().default(jsonObject),
    disqualifiers: jsonb("disqualifiers")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    method: text("method").notNull().default("deterministic"),
    inputFingerprint: text("input_fingerprint").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("opportunity_matches_profile_fingerprint_uidx").on(
      table.opportunityId,
      table.companyProfileId,
      table.inputFingerprint,
    ),
    index("opportunity_matches_profile_score_idx").on(table.companyProfileId, table.score),
    index("opportunity_matches_opportunity_idx").on(table.opportunityId),
  ],
);

export const savedOpportunities = pgTable(
  "saved_opportunities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    companyProfileId: uuid("company_profile_id").references(() => companyProfiles.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("saved"),
    notes: text("notes"),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("saved_opportunities_opportunity_profile_uidx").on(
      table.opportunityId,
      table.companyProfileId,
    ),
    index("saved_opportunities_status_idx").on(table.status, table.savedAt),
  ],
);

export const bidWorkspaces = pgTable(
  "bid_workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    companyProfileId: uuid("company_profile_id").references(() => companyProfiles.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    sourceSnapshot: jsonb("source_snapshot").$type<Record<string, unknown>>().notNull().default(jsonObject),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bid_workspaces_opportunity_profile_uidx").on(
      table.opportunityId,
      table.companyProfileId,
    ),
    index("bid_workspaces_status_idx").on(table.status, table.updatedAt),
  ],
);

export const bidRequirements = pgTable(
  "bid_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bidWorkspaceId: uuid("bid_workspace_id")
      .notNull()
      .references(() => bidWorkspaces.id, { onDelete: "cascade" }),
    sourceRequirementKey: text("source_requirement_key"),
    requirementType: text("requirement_type").notNull(),
    text: text("text").notNull(),
    isRequired: boolean("is_required").notNull().default(true),
    status: text("status").notNull().default("open"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonObject),
    responseNotes: text("response_notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bid_requirements_workspace_order_idx").on(table.bidWorkspaceId, table.sortOrder),
    index("bid_requirements_workspace_status_idx").on(table.bidWorkspaceId, table.status),
  ],
);

export const bidSections = pgTable(
  "bid_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bidWorkspaceId: uuid("bid_workspace_id")
      .notNull()
      .references(() => bidWorkspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructions: text("instructions"),
    content: text("content"),
    status: text("status").notNull().default("draft"),
    requirementLinks: jsonb("requirement_links")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    sortOrder: integer("sort_order").notNull().default(0),
    wordCount: bigint("word_count", { mode: "number" }).notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bid_sections_workspace_order_idx").on(table.bidWorkspaceId, table.sortOrder),
    index("bid_sections_workspace_status_idx").on(table.bidWorkspaceId, table.status),
  ],
);
