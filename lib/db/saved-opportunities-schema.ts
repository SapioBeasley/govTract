import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { companyProfiles } from "./canonical-schema";
import { opportunities } from "./schema";

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
    priority: integer("priority").notNull().default(0),
    internalDeadline: timestamp("internal_deadline", { withTimezone: true }),
    snapshotStatus: text("snapshot_status").notNull().default("not_required"),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("saved_opportunities_opportunity_profile_uidx").on(
      table.opportunityId,
      table.companyProfileId,
    ),
    uniqueIndex("saved_opportunities_single_user_opportunity_uidx")
      .on(table.opportunityId)
      .where(sql`${table.companyProfileId} IS NULL`),
    index("saved_opportunities_status_idx").on(table.status, table.savedAt),
    index("saved_opportunities_internal_deadline_idx").on(table.internalDeadline),
    check(
      "saved_opportunities_status_check",
      sql`${table.status} IN ('saved', 'reviewing', 'pursuing', 'no_bid', 'submitted', 'won', 'lost')`,
    ),
    check("saved_opportunities_priority_check", sql`${table.priority} BETWEEN 0 AND 5`),
    check(
      "saved_opportunities_snapshot_status_check",
      sql`${table.snapshotStatus} IN ('not_required', 'incomplete', 'complete', 'blocked')`,
    ),
  ],
);
