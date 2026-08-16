import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { organization, user } from "./better-auth-schema";

export const reportSettings = pgTable(
  "monthly_report_settings",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    timeZone: text("time_zone").notNull().default("UTC"),
    runDay: integer("run_day").notNull().default(4),
    runHour: integer("run_hour").notNull().default(9),
    isEnabled: boolean("is_enabled").notNull().default(false),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("monthly_report_settings_project_idx").on(table.projectId),
    index("monthly_report_settings_due_idx").on(
      table.isEnabled,
      table.nextRunAt,
    ),
  ],
);

export const reportSections = pgTable(
  "monthly_report_sections",
  {
    id: text("id").primaryKey(),
    settingsId: text("settings_id")
      .notNull()
      .references(() => reportSettings.id, { onDelete: "cascade" }),
    sectionKey: text("section_key", {
      enum: ["rankings", "gsc", "ga4", "google_ads", "audit", "backlinks"],
    }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
  },
  (table) => [
    uniqueIndex("monthly_report_sections_settings_key_idx").on(
      table.settingsId,
      table.sectionKey,
    ),
    uniqueIndex("monthly_report_sections_settings_order_idx").on(
      table.settingsId,
      table.sortOrder,
    ),
  ],
);

export const reportRuns = pgTable(
  "monthly_report_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    settingsId: text("settings_id")
      .notNull()
      .references(() => reportSettings.id, { onDelete: "cascade" }),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "published", "failed"],
    })
      .notNull()
      .default("queued"),
    scheduledKey: text("scheduled_key"),
    workflowInstanceId: text("workflow_instance_id"),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    compareStart: text("compare_start").notNull(),
    compareEnd: text("compare_end").notNull(),
    snapshotVersion: integer("snapshot_version").notNull().default(1),
    snapshotJson: text("snapshot_json"),
    errorMessage: text("error_message"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    startedAt: text("started_at"),
    publishedAt: text("published_at"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("monthly_report_runs_scheduled_key_idx").on(table.scheduledKey),
    uniqueIndex("monthly_report_runs_workflow_idx").on(
      table.workflowInstanceId,
    ),
    index("monthly_report_runs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("monthly_report_runs_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);

export const reportCommentaryItems = pgTable(
  "monthly_report_commentary_items",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["overview", "win", "watch", "next_step"],
    }).notNull(),
    text: text("text").notNull(),
    evidenceKey: text("evidence_key"),
    sortOrder: integer("sort_order").notNull(),
    isGenerated: boolean("is_generated").notNull().default(true),
    updatedByUserId: text("updated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("monthly_report_commentary_run_kind_order_idx").on(
      table.runId,
      table.kind,
      table.sortOrder,
    ),
    index("monthly_report_commentary_run_idx").on(table.runId),
  ],
);
