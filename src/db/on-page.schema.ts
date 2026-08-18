import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { ON_PAGE_BUCKETS, ON_PAGE_TARGET_SOURCES } from "@/shared/on-page";

// ============================================================================
// On-page SEO checker
//
// Target pages + keywords are the operator's intent (what to optimise).
// Ideas are the prescribed work. Re-running a page upserts on dedupe_key
// instead of inserting a second row, and clears resolved_at when the
// detector still fires. When a later run no longer detects an idea, we
// stamp resolved_at rather than deleting the row.
// ============================================================================

export const onPageTargetPages = sqliteTable(
  "on_page_target_pages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("on_page_target_pages_project_url_idx").on(
      table.projectId,
      table.url,
    ),
    index("on_page_target_pages_project_idx").on(table.projectId),
  ],
);

export const onPageTargetKeywords = sqliteTable(
  "on_page_target_keywords",
  {
    id: text("id").primaryKey(),
    targetPageId: text("target_page_id")
      .notNull()
      .references(() => onPageTargetPages.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull().default(2840),
    languageCode: text("language_code").notNull().default("en"),
    source: text("source", { enum: ON_PAGE_TARGET_SOURCES }).notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("on_page_target_keywords_page_keyword_idx").on(
      table.targetPageId,
      table.keyword,
      table.locationCode,
      table.languageCode,
    ),
    index("on_page_target_keywords_page_idx").on(table.targetPageId),
  ],
);

export const onPageIdeas = sqliteTable(
  "on_page_ideas",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    targetPageId: text("target_page_id")
      .notNull()
      .references(() => onPageTargetPages.id, { onDelete: "cascade" }),
    // Null for page-level ideas (technical audit mappings).
    targetKeywordId: text("target_keyword_id").references(
      () => onPageTargetKeywords.id,
      { onDelete: "set null" },
    ),
    bucket: text("bucket", { enum: ON_PAGE_BUCKETS }).notNull(),
    // Plain text so a new detector can register a type without a migration.
    ideaType: text("idea_type").notNull(),
    priority: text("priority", {
      enum: ["now", "next", "improve", "monitor"],
    }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    evidenceJson: text("evidence_json").notNull().default("{}"),
    dedupeKey: text("dedupe_key").notNull(),
    detectedAt: text("detected_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    lastSeenAt: text("last_seen_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    uniqueIndex("on_page_ideas_project_dedupe_idx").on(
      table.projectId,
      table.dedupeKey,
    ),
    index("on_page_ideas_project_bucket_idx").on(table.projectId, table.bucket),
    index("on_page_ideas_page_idx").on(table.targetPageId),
  ],
);

/**
 * Calendar-day cache of the organic top 10 for one keyword+market.
 * Re-opening a page or re-running the same day does not bill again.
 */
export const onPageSerpCache = sqliteTable(
  "on_page_serp_cache",
  {
    id: text("id").primaryKey(),
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    fetchedDate: text("fetched_date").notNull(),
    resultsJson: text("results_json").notNull(),
    fetchedAt: text("fetched_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("on_page_serp_cache_lookup_idx").on(
      table.keyword,
      table.locationCode,
      table.languageCode,
      table.fetchedDate,
    ),
  ],
);

export const onPageRuns = sqliteTable(
  "on_page_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["completed", "failed"] }).notNull(),
    pagesTotal: integer("pages_total").notNull().default(0),
    pagesProcessed: integer("pages_processed").notNull().default(0),
    serpFetches: integer("serp_fetches").notNull().default(0),
    ideasDetected: integer("ideas_detected").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("on_page_runs_project_started_idx").on(
      table.projectId,
      table.startedAt,
    ),
  ],
);
