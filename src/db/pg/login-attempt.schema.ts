import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestampColumn = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

// Postgres mirror of the SQLite table in ../login-attempt.schema.ts. See there
// for why this is keyed on the submitted email.
export const authLoginAttempt = pgTable(
  "auth_login_attempt",
  {
    email: text("email").primaryKey(),
    failedCount: integer("failed_count").notNull().default(0),
    lockLevel: integer("lock_level").notNull().default(0),
    lockedUntil: timestampColumn("locked_until"),
    lastFailedAt: timestampColumn("last_failed_at").defaultNow().notNull(),
  },
  (table) => [
    index("auth_login_attempt_last_failed_at_idx").on(table.lastFailedAt),
  ],
);
