import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";

// ============================================================================
// Rank Tracking tables
// ============================================================================

// One configuration per project+domain — defines what domain to track and how
export const rankTrackingConfigs = sqliteTable(
  "rank_tracking_configs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    // Search engine this config tracks. Immutable after creation: snapshots
    // carry no engine of their own, so flipping it would silently reinterpret
    // every historical position. Track Bing by creating a second config.
    engine: text("engine", { enum: ["google", "bing"] })
      .notNull()
      .default("google"),
    locationCode: integer("location_code").notNull().default(2840),
    languageCode: text("language_code").notNull().default("en"),
    devices: text("devices", {
      enum: ["both", "desktop", "mobile"],
    })
      .notNull()
      .default("both"),
    serpDepth: integer("serp_depth").notNull(),
    scheduleInterval: text("schedule_interval", {
      enum: ["daily", "weekly", "monthly", "manual"],
    })
      .notNull()
      .default("weekly"),
    locationName: text("location_name"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    lastCheckedAt: text("last_checked_at"),
    nextCheckAt: text("next_check_at"),
    lastSkipReason: text("last_skip_reason"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("rank_tracking_configs_project_active_created_idx").on(
      table.projectId,
      table.isActive,
      table.createdAt,
    ),
    // Engine participates in both uniqueness rules so the same domain can be
    // tracked on Google and Bing side by side in one location.
    uniqueIndex("rank_tracking_configs_national_idx")
      .on(table.projectId, table.domain, table.engine, table.locationCode)
      .where(sql`${table.locationName} IS NULL`),
    uniqueIndex("rank_tracking_configs_local_idx")
      .on(
        table.projectId,
        table.domain,
        table.engine,
        table.locationCode,
        table.locationName,
      )
      .where(sql`${table.locationName} IS NOT NULL`),
  ],
);

// Keywords tracked per domain config
export const rankTrackingKeywords = sqliteTable(
  "rank_tracking_keywords",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => rankTrackingConfigs.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    searchVolume: integer("search_volume"),
    keywordDifficulty: integer("keyword_difficulty"),
    cpc: real("cpc"),
    metricsFetchedAt: text("metrics_fetched_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("rank_tracking_keywords_config_keyword_idx").on(
      table.configId,
      table.keyword,
    ),
  ],
);

// One row per check execution (manual or scheduled).
// A partial unique index on `config_id WHERE status IN ('pending','running')`
// enforces at most one in-flight run per config at the DB level, which is how
// duplicate-trigger protection is implemented — INSERT of a second pending run
// for the same config fails with a unique-constraint violation.
export const rankCheckRuns = sqliteTable(
  "rank_check_runs",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => rankTrackingConfigs.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    keywordsTotal: integer("keywords_total").notNull().default(0),
    keywordsChecked: integer("keywords_checked").notNull().default(0),
    isSubsetRun: integer("is_subset_run", { mode: "boolean" })
      .notNull()
      .default(false),
    errorMessage: text("error_message"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("rank_check_runs_config_idx").on(table.configId, table.startedAt),
    index("rank_check_runs_project_idx").on(table.projectId, table.startedAt),
    uniqueIndex("rank_check_runs_one_active_per_config_idx")
      .on(table.configId)
      .where(sql`${table.status} IN ('pending', 'running')`),
  ],
);

// One row per keyword per device per check run
export const rankSnapshots = sqliteTable(
  "rank_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => rankCheckRuns.id, { onDelete: "cascade" }),
    // No FK to rankTrackingKeywords — intentional. Historical snapshots are
    // preserved after a keyword is removed from tracking so users can still
    // see past position data for deleted keywords.
    trackingKeywordId: text("tracking_keyword_id").notNull(),
    keyword: text("keyword").notNull(),
    device: text("device", { enum: ["desktop", "mobile"] }).notNull(),
    position: integer("position"), // null = not found in top 20
    url: text("url"),
    serpFeatures: text("serp_features"), // JSON array of feature type strings
    checkedAt: text("checked_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    // No standalone index on runId — the unique index below has it as its
    // leftmost column, so it already serves runId lookups.
    index("rank_snapshots_keyword_device_idx").on(
      table.trackingKeywordId,
      table.device,
      table.checkedAt,
    ),
    uniqueIndex("rank_snapshots_run_keyword_device_idx").on(
      table.runId,
      table.trackingKeywordId,
      table.device,
    ),
  ],
);
