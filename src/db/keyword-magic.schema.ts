import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";

/**
 * Persisted Keyword Magic result set. One row per seed + market + scale.
 * Re-filter, re-sort, and pagination read this table and never re-bill.
 */
export const keywordMagicRuns = sqliteTable(
  "keyword_magic_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    seed: text("seed").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    clickstream: integer("clickstream", { mode: "boolean" })
      .notNull()
      .default(false),
    maxKeywords: integer("max_keywords").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: text("status", { enum: ["ready", "failed"] })
      .notNull()
      .default("ready"),
    provider: text("provider", { enum: ["labs", "google_ads"] }).notNull(),
    keywordCount: integer("keyword_count").notNull().default(0),
    estimatedCostCredits: integer("estimated_cost_credits")
      .notNull()
      .default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("keyword_magic_runs_project_fingerprint_idx").on(
      table.projectId,
      table.fingerprint,
    ),
    index("keyword_magic_runs_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const keywordMagicClusters = sqliteTable(
  "keyword_magic_clusters",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => keywordMagicRuns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keywordCount: integer("keyword_count").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("keyword_magic_clusters_run_name_idx").on(
      table.runId,
      table.name,
    ),
    index("keyword_magic_clusters_run_sort_idx").on(
      table.runId,
      table.sortOrder,
    ),
  ],
);

export const keywordMagicKeywords = sqliteTable(
  "keyword_magic_keywords",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => keywordMagicRuns.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id").references(() => keywordMagicClusters.id, {
      onDelete: "set null",
    }),
    keyword: text("keyword").notNull(),
    searchVolume: integer("search_volume"),
    cpc: real("cpc"),
    competition: real("competition"),
    keywordDifficulty: integer("keyword_difficulty"),
    intent: text("intent"),
    wordCount: integer("word_count").notNull(),
    isBroad: integer("is_broad", { mode: "boolean" }).notNull().default(false),
    isPhrase: integer("is_phrase", { mode: "boolean" })
      .notNull()
      .default(false),
    isExact: integer("is_exact", { mode: "boolean" }).notNull().default(false),
    isQuestion: integer("is_question", { mode: "boolean" })
      .notNull()
      .default(false),
    source: text("source", {
      enum: ["related", "suggestions", "ideas", "google_ads"],
    }).notNull(),
    metricsUpdatedAt: text("metrics_updated_at"),
  },
  (table) => [
    uniqueIndex("keyword_magic_keywords_run_keyword_idx").on(
      table.runId,
      table.keyword,
    ),
    index("keyword_magic_keywords_run_cluster_idx").on(
      table.runId,
      table.clusterId,
    ),
    index("keyword_magic_keywords_run_volume_idx").on(
      table.runId,
      table.searchVolume,
    ),
    index("keyword_magic_keywords_run_word_count_idx").on(
      table.runId,
      table.wordCount,
    ),
  ],
);

export const keywordMagicSerpFeatures = sqliteTable(
  "keyword_magic_serp_features",
  {
    keywordId: text("keyword_id")
      .notNull()
      .references(() => keywordMagicKeywords.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.keywordId, table.feature] }),
    index("keyword_magic_serp_features_feature_idx").on(table.feature),
  ],
);
