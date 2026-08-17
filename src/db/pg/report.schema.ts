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
import {
  REPORT_ARTIFACT_KINDS,
  REPORT_DELIVERY_FREQUENCIES,
  REPORT_DELIVERY_STATUSES,
} from "@/shared/report-delivery";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

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
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
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
    // Set when a delivery profile scheduled the run. Null keeps the existing
    // project-settings behaviour untouched.
    profileId: text("profile_id").references(() => reportDeliveryProfiles.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(isoNow),
    startedAt: text("started_at"),
    publishedAt: text("published_at"),
    updatedAt: text("updated_at").notNull().default(isoNow),
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
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
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

// A named delivery profile is what an agency actually configures: which
// sections a client sees, the branding on the PDF, who receives it, and when.
// It is deliberately separate from `monthly_report_settings` so one project can
// run several audiences (internal weekly, client monthly) off one snapshot
// pipeline.
export const reportDeliveryProfiles = pgTable(
  "monthly_report_delivery_profiles",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    frequency: text("frequency", { enum: REPORT_DELIVERY_FREQUENCIES })
      .notNull()
      .default("monthly"),
    timeZone: text("time_zone").notNull().default("UTC"),
    // Monthly schedules use runDay (1-28); weekly schedules use runWeekday
    // (0 = Sunday); daily schedules use neither.
    runDay: integer("run_day"),
    runWeekday: integer("run_weekday"),
    runHour: integer("run_hour").notNull().default(9),
    isEnabled: boolean("is_enabled").notNull().default(false),
    brandName: text("brand_name"),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color"),
    accentColor: text("accent_color"),
    attachPdf: boolean("attach_pdf").notNull().default(true),
    includeShareLink: boolean("include_share_link").notNull().default(true),
    shareLinkTtlDays: integer("share_link_ttl_days").notNull().default(30),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("monthly_report_delivery_profiles_project_name_idx").on(
      table.projectId,
      table.name,
    ),
    index("monthly_report_delivery_profiles_due_idx").on(
      table.isEnabled,
      table.nextRunAt,
    ),
  ],
);

export const reportDeliveryProfileSections = pgTable(
  "monthly_report_delivery_profile_sections",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => reportDeliveryProfiles.id, { onDelete: "cascade" }),
    sectionKey: text("section_key", {
      enum: ["rankings", "gsc", "ga4", "google_ads", "audit", "backlinks"],
    }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
  },
  (table) => [
    uniqueIndex("monthly_report_profile_sections_profile_key_idx").on(
      table.profileId,
      table.sectionKey,
    ),
    uniqueIndex("monthly_report_profile_sections_profile_order_idx").on(
      table.profileId,
      table.sortOrder,
    ),
  ],
);

export const reportRecipients = pgTable(
  "monthly_report_recipients",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => reportDeliveryProfiles.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("monthly_report_recipients_profile_email_idx").on(
      table.profileId,
      table.email,
    ),
  ],
);

export const reportArtifacts = pgTable(
  "monthly_report_artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: REPORT_ARTIFACT_KINDS }).notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes"),
    checksumSha256: text("checksum_sha256"),
    // Retention horizon written at creation so the purge job is a single
    // indexed range scan instead of per-row date arithmetic.
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("monthly_report_artifacts_run_kind_idx").on(
      table.runId,
      table.kind,
    ),
    index("monthly_report_artifacts_expires_idx").on(table.expiresAt),
  ],
);

// Only the SHA-256 of the token is stored: a database leak cannot be replayed
// against the share endpoint.
export const reportShareLinks = pgTable(
  "monthly_report_share_links",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    lastAccessedAt: text("last_accessed_at"),
    accessCount: integer("access_count").notNull().default(0),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("monthly_report_share_links_run_idx").on(table.runId),
    index("monthly_report_share_links_expires_idx").on(table.expiresAt),
  ],
);

export const reportDeliveries = pgTable(
  "monthly_report_deliveries",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),
    profileId: text("profile_id").references(() => reportDeliveryProfiles.id, {
      onDelete: "set null",
    }),
    recipientId: text("recipient_id").references(() => reportRecipients.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    name: text("name"),
    status: text("status", { enum: REPORT_DELIVERY_STATUSES })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    // Stable across retries so a provider-side retry of the same attempt is
    // deduplicated by Resend rather than mailing the client twice.
    idempotencyKey: text("idempotency_key").notNull(),
    providerMessageId: text("provider_message_id"),
    errorMessage: text("error_message"),
    isTest: boolean("is_test").notNull().default(false),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    // isTest is part of the key so a diagnostic send to an address that is
    // also a real recipient does not collide with the client's delivery row.
    uniqueIndex("monthly_report_deliveries_run_email_idx").on(
      table.runId,
      table.email,
      table.isTest,
    ),
    index("monthly_report_deliveries_run_status_idx").on(
      table.runId,
      table.status,
    ),
    index("monthly_report_deliveries_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);
