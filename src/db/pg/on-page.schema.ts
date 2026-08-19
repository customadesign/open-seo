import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { ON_PAGE_BUCKETS, ON_PAGE_TARGET_SOURCES } from "@/shared/on-page";

// Postgres mirror of on-page.schema.ts. Structural parity is enforced by
// schema-parity.test.ts — read the SQLite file for the design commentary.

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const timestampColumn = (name: string) => text(name);

export const onPageTargetPages = pgTable(
  "on_page_target_pages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("on_page_target_pages_project_url_idx").on(
      table.projectId,
      table.url,
    ),
    index("on_page_target_pages_project_idx").on(table.projectId),
  ],
);

export const onPageTargetKeywords = pgTable(
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
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
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

export const onPageIdeas = pgTable(
  "on_page_ideas",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    targetPageId: text("target_page_id")
      .notNull()
      .references(() => onPageTargetPages.id, { onDelete: "cascade" }),
    targetKeywordId: text("target_keyword_id").references(
      () => onPageTargetKeywords.id,
      { onDelete: "set null" },
    ),
    bucket: text("bucket", { enum: ON_PAGE_BUCKETS }).notNull(),
    ideaType: text("idea_type").notNull(),
    priority: text("priority", {
      enum: ["now", "next", "improve", "monitor"],
    }).notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    evidenceJson: text("evidence_json").notNull().default("{}"),
    dedupeKey: text("dedupe_key").notNull(),
    detectedAt: timestampColumn("detected_at").notNull().default(isoNow),
    lastSeenAt: timestampColumn("last_seen_at").notNull().default(isoNow),
    resolvedAt: timestampColumn("resolved_at"),
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

export const onPageSerpCache = pgTable(
  "on_page_serp_cache",
  {
    id: text("id").primaryKey(),
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    fetchedDate: text("fetched_date").notNull(),
    resultsJson: text("results_json").notNull(),
    fetchedAt: timestampColumn("fetched_at").notNull().default(isoNow),
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

export const onPageRuns = pgTable(
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
    startedAt: timestampColumn("started_at").notNull().default(isoNow),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    index("on_page_runs_project_started_idx").on(
      table.projectId,
      table.startedAt,
    ),
  ],
);
