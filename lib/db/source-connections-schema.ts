import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const jsonObject = sql`'{}'::jsonb`;

export const sourceConnections = pgTable(
  "source_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    accountIdentifier: text("account_identifier"),
    status: text("status").notNull().default("disconnected"),
    sessionEnvelopeVersion: integer("session_envelope_version").notNull().default(1),
    encryptedSession: text("encrypted_session"),
    sessionExpiresAt: timestamp("session_expires_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastError: text("last_error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(jsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("source_connections_provider_uidx").on(table.provider),
    index("source_connections_status_idx").on(table.status),
    check(
      "source_connections_status_check",
      sql`${table.status} in ('connected', 'needs_reauth', 'disconnected')`,
    ),
  ],
);
