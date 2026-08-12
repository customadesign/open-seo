import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "./better-auth-schema";
import { projects } from "./app.schema";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const reportTemplates = pgTable(
  "report_templates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    brandName: text("brand_name"),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color"),
    accentColor: text("accent_color"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    index("report_templates_organization_project_idx").on(
      table.organizationId,
      table.projectId,
    ),
  ],
);

export const reportTemplateSections = pgTable(
  "report_template_sections",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => reportTemplates.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    sortOrder: integer("sort_order").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
  },
  (table) => [
    uniqueIndex("report_template_sections_template_key_idx").on(
      table.templateId,
      table.sectionKey,
    ),
    uniqueIndex("report_template_sections_template_order_idx").on(
      table.templateId,
      table.sortOrder,
    ),
  ],
);

export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references(() => reportTemplates.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    frequency: text("frequency", { enum: ["manual", "weekly", "monthly"] })
      .notNull()
      .default("monthly"),
    timezone: text("timezone").notNull().default("UTC"),
    isActive: boolean("is_active").notNull().default(true),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    index("report_schedules_project_due_idx").on(
      table.projectId,
      table.isActive,
      table.nextRunAt,
    ),
  ],
);

export const reportRecipients = pgTable(
  "report_recipients",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => reportSchedules.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("report_recipients_schedule_email_idx").on(
      table.scheduleId,
      table.email,
    ),
  ],
);

export const reportRuns = pgTable(
  "report_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references(() => reportTemplates.id, { onDelete: "restrict" }),
    scheduleId: text("schedule_id").references(() => reportSchedules.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["queued", "rendering", "sending", "completed", "failed"],
    })
      .notNull()
      .default("queued"),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    snapshotJson: text("snapshot_json"),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull().default(isoNow),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("report_runs_project_started_idx").on(
      table.projectId,
      table.startedAt,
    ),
    index("report_runs_schedule_started_idx").on(
      table.scheduleId,
      table.startedAt,
    ),
  ],
);

export const reportArtifacts = pgTable(
  "report_artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["html", "pdf", "json"] }).notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes"),
    checksumSha256: text("checksum_sha256"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("report_artifacts_run_kind_idx").on(table.runId, table.kind),
  ],
);

export const reportShareLinks = pgTable(
  "report_share_links",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    lastAccessedAt: text("last_accessed_at"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [index("report_share_links_run_idx").on(table.runId)],
);

export const reportDeliveries = pgTable(
  "report_deliveries",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id").references(() => reportRecipients.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    providerMessageId: text("provider_message_id"),
    errorMessage: text("error_message"),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("report_deliveries_run_email_idx").on(table.runId, table.email),
    index("report_deliveries_run_status_idx").on(table.runId, table.status),
  ],
);
