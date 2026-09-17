import { sql } from "drizzle-orm";
import {
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

import { agencies, vendors } from "./canonical-schema";
import { opportunities, sourceRecords } from "./schema";

const jsonObject = sql`'{}'::jsonb`;

export const historicalProcurementRecords = pgTable(
  "historical_procurement_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recordType: text("record_type").notNull(),
    agencyId: uuid("agency_id").references(() => agencies.id, { onDelete: "set null" }),
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    title: text("title"),
    description: text("description"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    fiscalYear: integer("fiscal_year"),
    monetaryType: text("monetary_type"),
    amount: numeric("amount", { precision: 20, scale: 2 }),
    currency: text("currency").notNull().default("USD"),
    buyerName: text("buyer_name"),
    buyerUnitName: text("buyer_unit_name"),
    buyerSourceId: text("buyer_source_id"),
    vendorName: text("vendor_name"),
    vendorSourceId: text("vendor_source_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("historical_procurement_records_type_date_idx").on(table.recordType, table.occurredAt),
    index("historical_procurement_records_agency_date_idx").on(table.agencyId, table.occurredAt),
    index("historical_procurement_records_vendor_date_idx").on(table.vendorId, table.occurredAt),
    index("historical_procurement_records_monetary_idx").on(table.monetaryType, table.occurredAt),
  ],
);

export const historicalProcurementSourceRecords = pgTable(
  "historical_procurement_source_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    historicalProcurementRecordId: uuid("historical_procurement_record_id")
      .notNull()
      .references(() => historicalProcurementRecords.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    sourceFactKey: text("source_fact_key").notNull(),
    sourceFileId: text("source_file_id"),
    sourceFileRevision: text("source_file_revision"),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }),
    normalizedPayload: jsonb("normalized_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(jsonObject),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("historical_procurement_source_records_source_fact_uidx").on(
      table.sourceRecordId,
      table.sourceFactKey,
    ),
    index("historical_procurement_source_records_record_idx").on(
      table.historicalProcurementRecordId,
    ),
    index("historical_procurement_source_records_file_idx").on(
      table.sourceFileId,
      table.sourceFileRevision,
    ),
  ],
);

export const historicalProcurementIdentifiers = pgTable(
  "historical_procurement_identifiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    historicalProcurementRecordId: uuid("historical_procurement_record_id")
      .notNull()
      .references(() => historicalProcurementRecords.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id, {
      onDelete: "set null",
    }),
    identifierType: text("identifier_type").notNull(),
    identifierValue: text("identifier_value").notNull(),
    sourceProvided: boolean("source_provided").notNull().default(true),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("historical_procurement_identifiers_record_type_value_uidx").on(
      table.historicalProcurementRecordId,
      table.identifierType,
      table.identifierValue,
    ),
    index("historical_procurement_identifiers_lookup_idx").on(
      table.identifierType,
      table.identifierValue,
    ),
  ],
);

export const historicalProcurementClassifications = pgTable(
  "historical_procurement_classifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    historicalProcurementRecordId: uuid("historical_procurement_record_id")
      .notNull()
      .references(() => historicalProcurementRecords.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id, {
      onDelete: "set null",
    }),
    sourceClassificationKey: text("source_classification_key").notNull(),
    scheme: text("scheme").notNull(),
    code: text("code"),
    name: text("name"),
    method: text("method").notNull(),
    confidence: integer("confidence"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("historical_procurement_classifications_record_key_uidx").on(
      table.historicalProcurementRecordId,
      table.sourceClassificationKey,
    ),
    index("historical_procurement_classifications_scheme_code_idx").on(
      table.scheme,
      table.code,
    ),
  ],
);

export const historicalProcurementRelationships = pgTable(
  "historical_procurement_relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fromHistoricalProcurementRecordId: uuid("from_historical_procurement_record_id")
      .notNull()
      .references(() => historicalProcurementRecords.id, { onDelete: "cascade" }),
    toHistoricalProcurementRecordId: uuid("to_historical_procurement_record_id")
      .notNull()
      .references(() => historicalProcurementRecords.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    method: text("method").notNull(),
    confidence: integer("confidence"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("historical_procurement_relationships_uidx").on(
      table.fromHistoricalProcurementRecordId,
      table.toHistoricalProcurementRecordId,
      table.relationshipType,
    ),
    index("historical_procurement_relationships_from_idx").on(
      table.fromHistoricalProcurementRecordId,
    ),
    index("historical_procurement_relationships_to_idx").on(
      table.toHistoricalProcurementRecordId,
    ),
  ],
);

export const historicalProcurementOpportunityRelationships = pgTable(
  "historical_procurement_opportunity_relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    historicalProcurementRecordId: uuid("historical_procurement_record_id")
      .notNull()
      .references(() => historicalProcurementRecords.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    method: text("method").notNull(),
    confidence: integer("confidence"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("historical_procurement_opportunity_relationships_uidx").on(
      table.historicalProcurementRecordId,
      table.opportunityId,
      table.relationshipType,
    ),
    index("historical_procurement_opportunity_relationships_record_idx").on(
      table.historicalProcurementRecordId,
    ),
    index("historical_procurement_opportunity_relationships_opportunity_idx").on(
      table.opportunityId,
    ),
  ],
);
