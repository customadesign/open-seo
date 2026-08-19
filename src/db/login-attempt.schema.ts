import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// One row per email that has failed a password sign-in. Keyed on the submitted
// address rather than a user id so attempts against addresses with no account
// are counted too. Rows are disposable — deleting one just grants a fresh three
// attempts, which is the manual unlock path.
export const authLoginAttempt = sqliteTable(
  "auth_login_attempt",
  {
    email: text("email").primaryKey(),
    failedCount: integer("failed_count").notNull().default(0),
    lockLevel: integer("lock_level").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    lastFailedAt: integer("last_failed_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    // Supports pruning rows that have decayed past the escalation window.
    index("auth_login_attempt_last_failed_at_idx").on(table.lastFailedAt),
  ],
);
