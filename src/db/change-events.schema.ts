import { sql } from "drizzle-orm";
import {
  index,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { user } from "./better-auth-schema";
import {
  CHANGE_EVENT_SEVERITIES,
  CHANGE_EVENT_SOURCES,
} from "@/shared/change-events";

export const projectChangeEvents = sqliteTable(
  "project_change_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    source: text("source", { enum: CHANGE_EVENT_SOURCES }).notNull(),
    eventType: text("event_type").notNull(),
    severity: text("severity", { enum: CHANGE_EVENT_SEVERITIES }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    sourceRunId: text("source_run_id"),
    // The detector's identity for this change. The unique index on it makes
    // re-running a detector idempotent instead of duplicating the alert.
    dedupeKey: text("dedupe_key").notNull(),
    metricKey: text("metric_key"),
    previousNumericValue: real("previous_numeric_value"),
    currentNumericValue: real("current_numeric_value"),
    unit: text("unit"),
    occurredAt: text("occurred_at").notNull(),
    detectedAt: text("detected_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    // Comparison windows as YYYY-MM-DD, populated only by detectors that compare
    // two date ranges (GA4, GSC). Run-to-run detectors (audit, rank tracking,
    // backlinks, reports) leave these null, as do rows written before this
    // existed — events are insert-only, so there is nothing to backfill.
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    previousPeriodStart: text("previous_period_start"),
    previousPeriodEnd: text("previous_period_end"),
  },
  (table) => [
    uniqueIndex("project_change_events_project_source_dedupe_idx").on(
      table.projectId,
      table.source,
      table.dedupeKey,
    ),
    index("project_change_events_project_occurred_idx").on(
      table.projectId,
      table.occurredAt,
    ),
    index("project_change_events_project_source_occurred_idx").on(
      table.projectId,
      table.source,
      table.occurredAt,
    ),
  ],
);

// Absence means unread. Keeping state separate makes the event immutable and
// prevents one teammate reading an alert from hiding it for everyone else.
export const projectChangeEventStates = sqliteTable(
  "project_change_event_states",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => projectChangeEvents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    readAt: text("read_at"),
    dismissedAt: text("dismissed_at"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("project_change_event_states_event_user_idx").on(
      table.eventId,
      table.userId,
    ),
    index("project_change_event_states_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  ],
);
