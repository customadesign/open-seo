import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const timestampColumn = (name: string) => text(name);

export const keywordMagicRuns = pgTable(
  "keyword_magic_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    seed: text("seed").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    clickstream: boolean("clickstream").notNull().default(false),
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
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    expiresAt: timestampColumn("expires_at").notNull(),
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

export const keywordMagicClusters = pgTable(
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

export const keywordMagicKeywords = pgTable(
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
    isBroad: boolean("is_broad").notNull().default(false),
    isPhrase: boolean("is_phrase").notNull().default(false),
    isExact: boolean("is_exact").notNull().default(false),
    isQuestion: boolean("is_question").notNull().default(false),
    source: text("source", {
      enum: ["related", "suggestions", "ideas", "google_ads"],
    }).notNull(),
    metricsUpdatedAt: timestampColumn("metrics_updated_at"),
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

export const keywordMagicSerpFeatures = pgTable(
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
