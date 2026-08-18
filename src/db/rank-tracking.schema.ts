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
    /**
     * Approval ceiling in credits for a single scheduled check. NULL means no
     * approval exists: the scheduler skips the config with `cost_ceiling`
     * rather than spending an unbounded amount, which is what keeps rows
     * migrated from before this column from billing silently.
     */
    maxCostCredits: integer("max_cost_credits"),
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
    /**
     * True after rank_serp_entries for this run were pruned. Position
     * snapshots are never deleted. serp_captured on snapshots still means
     * "this check wrote SERP detail", not "the detail is still stored".
     */
    serpPruned: integer("serp_pruned", { mode: "boolean" })
      .notNull()
      .default(false),
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
    // True when this check also wrote rank_serp_entries. Historical rows stay
    // false so reports can say "not captured" instead of inventing zeros.
    serpCaptured: integer("serp_captured", { mode: "boolean" })
      .notNull()
      .default(false),
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

/**
 * Extra SERP rows captured from the same rank-check response that writes
 * rank_snapshots. No extra provider call. Historical snapshots have no rows
 * here — reports must treat that as "not captured", not as zero competitors
 * or no cannibalization. Retention deletes only these rows (newest N checks
 * plus a minimum age floor). It never deletes rank_snapshots or
 * rank_check_runs — position history stays complete.
 *
 * rowKind:
 * - owned: a tracked-domain organic URL (identity = normalized URL)
 * - competitor: another organic domain (identity = domain)
 * - feature: a non-organic SERP type (identity = type; featureOwned = held)
 */
export const rankSerpEntries = sqliteTable(
  "rank_serp_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => rankCheckRuns.id, { onDelete: "cascade" }),
    trackingKeywordId: text("tracking_keyword_id").notNull(),
    device: text("device", { enum: ["desktop", "mobile"] }).notNull(),
    rowKind: text("row_kind", {
      enum: ["owned", "competitor", "feature"],
    }).notNull(),
    identity: text("identity").notNull(),
    domain: text("domain"),
    url: text("url"),
    position: integer("position"),
    featureOwned: integer("feature_owned", { mode: "boolean" }),
  },
  (table) => [
    uniqueIndex("rank_serp_entries_run_kw_device_kind_identity_idx").on(
      table.runId,
      table.trackingKeywordId,
      table.device,
      table.rowKind,
      table.identity,
    ),
    index("rank_serp_entries_run_kind_device_idx").on(
      table.runId,
      table.rowKind,
      table.device,
    ),
  ],
);
