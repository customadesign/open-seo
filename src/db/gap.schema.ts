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
import { KEYWORD_GAP_CLASSIFICATIONS } from "@/shared/gap";

export const keywordGapRuns = sqliteTable(
  "keyword_gap_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    includeSubdomains: integer("include_subdomains", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    fetchedAt: text("fetched_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("keyword_gap_runs_project_fingerprint_idx").on(
      table.projectId,
      table.fingerprint,
    ),
    index("keyword_gap_runs_project_fetched_idx").on(
      table.projectId,
      table.fetchedAt,
    ),
  ],
);

export const keywordGapRunDomains = sqliteTable(
  "keyword_gap_run_domains",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => keywordGapRuns.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    role: text("role", { enum: ["base", "competitor"] }).notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("keyword_gap_run_domains_run_domain_idx").on(
      table.runId,
      table.domain,
    ),
    index("keyword_gap_run_domains_run_sort_idx").on(
      table.runId,
      table.sortOrder,
    ),
  ],
);

export const keywordGapKeywords = sqliteTable(
  "keyword_gap_keywords",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => keywordGapRuns.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    searchVolume: integer("search_volume"),
    keywordDifficulty: integer("keyword_difficulty"),
    intent: text("intent"),
    cpc: real("cpc"),
    classification: text("classification", {
      enum: KEYWORD_GAP_CLASSIFICATIONS,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("keyword_gap_keywords_run_keyword_idx").on(
      table.runId,
      table.keyword,
    ),
    index("keyword_gap_keywords_run_class_idx").on(
      table.runId,
      table.classification,
    ),
  ],
);

export const keywordGapPositions = sqliteTable(
  "keyword_gap_positions",
  {
    id: text("id").primaryKey(),
    keywordId: text("keyword_id")
      .notNull()
      .references(() => keywordGapKeywords.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    position: integer("position"),
  },
  (table) => [
    uniqueIndex("keyword_gap_positions_keyword_domain_idx").on(
      table.keywordId,
      table.domain,
    ),
    index("keyword_gap_positions_keyword_idx").on(table.keywordId),
  ],
);

export const backlinkGapRuns = sqliteTable(
  "backlink_gap_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("backlink_gap_runs_project_fingerprint_idx").on(
      table.projectId,
      table.fingerprint,
    ),
    index("backlink_gap_runs_project_fetched_idx").on(
      table.projectId,
      table.fetchedAt,
    ),
  ],
);

export const backlinkGapRunDomains = sqliteTable(
  "backlink_gap_run_domains",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => backlinkGapRuns.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    role: text("role", { enum: ["base", "competitor"] }).notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("backlink_gap_run_domains_run_domain_idx").on(
      table.runId,
      table.domain,
    ),
    index("backlink_gap_run_domains_run_sort_idx").on(
      table.runId,
      table.sortOrder,
    ),
  ],
);

export const backlinkGapReferringDomains = sqliteTable(
  "backlink_gap_referring_domains",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => backlinkGapRuns.id, { onDelete: "cascade" }),
    referringDomain: text("referring_domain").notNull(),
    rank: integer("rank"),
    firstSeen: text("first_seen"),
    competitorCount: integer("competitor_count").notNull(),
  },
  (table) => [
    uniqueIndex("backlink_gap_referring_domains_run_domain_idx").on(
      table.runId,
      table.referringDomain,
    ),
    index("backlink_gap_referring_domains_run_rank_idx").on(
      table.runId,
      table.rank,
    ),
  ],
);

export const backlinkGapLinks = sqliteTable(
  "backlink_gap_links",
  {
    id: text("id").primaryKey(),
    referringDomainId: text("referring_domain_id")
      .notNull()
      .references(() => backlinkGapReferringDomains.id, {
        onDelete: "cascade",
      }),
    competitorDomain: text("competitor_domain").notNull(),
  },
  (table) => [
    uniqueIndex("backlink_gap_links_ref_competitor_idx").on(
      table.referringDomainId,
      table.competitorDomain,
    ),
    index("backlink_gap_links_referring_idx").on(table.referringDomainId),
  ],
);
