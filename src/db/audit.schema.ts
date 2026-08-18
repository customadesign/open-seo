import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";

// ============================================================================
// Site Audit tables
// ============================================================================

// One row per audit run
export const audits = sqliteTable(
  "audits",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    startedByUserId: text("started_by_user_id").notNull(),
    startUrl: text("start_url").notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed"],
    })
      .notNull()
      .default("running"),
    workflowInstanceId: text("workflow_instance_id"),
    // JSON config: { maxPages, lighthouseStrategy }
    config: text("config").notNull().default("{}"),
    // Progress & summary
    pagesCrawled: integer("pages_crawled").notNull().default(0),
    pagesTotal: integer("pages_total").notNull().default(0),
    lighthouseTotal: integer("lighthouse_total").notNull().default(0),
    lighthouseCompleted: integer("lighthouse_completed").notNull().default(0),
    lighthouseFailed: integer("lighthouse_failed").notNull().default(0),
    currentPhase: text("current_phase").default("discovery"),
    // Failure diagnostics; null unless status = "failed". errorCode is a
    // closed vocabulary (see classifyAuditError) so failures are aggregable;
    // errorDetail is the raw message, truncated. failedPhase records which
    // currentPhase the audit was in when it died.
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    failedPhase: text("failed_phase"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("audits_project_id_idx").on(table.projectId),
    index("audits_started_by_user_id_idx").on(table.startedByUserId),
  ],
);

// One row per crawled page
export const auditPages = sqliteTable(
  "audit_pages",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    statusCode: integer("status_code"),
    redirectUrl: text("redirect_url"),
    // Metadata
    title: text("title"),
    metaDescription: text("meta_description"),
    canonicalUrl: text("canonical_url"),
    robotsMeta: text("robots_meta"),
    // Open Graph
    ogTitle: text("og_title"),
    ogDescription: text("og_description"),
    ogImage: text("og_image"),
    // Headings
    h1Count: integer("h1_count").notNull().default(0),
    h2Count: integer("h2_count").notNull().default(0),
    h3Count: integer("h3_count").notNull().default(0),
    h4Count: integer("h4_count").notNull().default(0),
    h5Count: integer("h5_count").notNull().default(0),
    h6Count: integer("h6_count").notNull().default(0),
    headingOrderJson: text("heading_order_json"),
    // Content
    wordCount: integer("word_count").notNull().default(0),
    // Images
    imagesTotal: integer("images_total").notNull().default(0),
    imagesMissingAlt: integer("images_missing_alt").notNull().default(0),
    imagesJson: text("images_json"),
    // Links
    internalLinkCount: integer("internal_link_count").notNull().default(0),
    externalLinkCount: integer("external_link_count").notNull().default(0),
    // Structured data
    hasStructuredData: integer("has_structured_data", { mode: "boolean" })
      .notNull()
      .default(false),
    // Hreflang
    hreflangTagsJson: text("hreflang_tags_json"),
    // Indexability
    isIndexable: integer("is_indexable", { mode: "boolean" })
      .notNull()
      .default(true),
    // Indexability/canonical signals from response headers
    xRobotsTag: text("x_robots_tag"),
    headerCanonicalUrl: text("header_canonical_url"),
    // Crawl metadata
    // null depth = not reached via links (e.g. sitemap-seeded)
    crawlDepth: integer("crawl_depth"),
    inSitemap: integer("in_sitemap", { mode: "boolean" })
      .notNull()
      .default(false),
    // SHA-256 of the visible body text, for duplicate-content grouping
    contentHash: text("content_hash"),
    // How the fetch resolved: ok | blocked (WAF/bot challenge) | error
    fetchClass: text("fetch_class", { enum: ["ok", "blocked", "error"] })
      .notNull()
      .default("ok"),
    // Performance
    responseTimeMs: integer("response_time_ms"),
    // Document / resource signals captured during crawl for later slices
    htmlBytes: integer("html_bytes").notNull().default(0),
    hasDoctype: integer("has_doctype", { mode: "boolean" })
      .notNull()
      .default(false),
    charset: text("charset"),
    hasMetaRefresh: integer("has_meta_refresh", { mode: "boolean" })
      .notNull()
      .default(false),
    frameCount: integer("frame_count").notNull().default(0),
    scriptUrlsJson: text("script_urls_json"),
    stylesheetUrlsJson: text("stylesheet_urls_json"),
    inlineScriptBytes: integer("inline_script_bytes").notNull().default(0),
    inlineStyleBytes: integer("inline_style_bytes").notNull().default(0),
    textBytes: integer("text_bytes").notNull().default(0),
    externalImageSrcsJson: text("external_image_srcs_json"),
    contentEncoding: text("content_encoding"),
    cacheControl: text("cache_control"),
    contentType: text("content_type"),
    contentLength: integer("content_length"),
  },
  (table) => [index("audit_pages_audit_url_idx").on(table.auditId, table.url)],
);

// Link edges live in the per-audit AuditScratchpad Durable Object for the
// duration of the crawl; they are never persisted to the app DB.

// One row per (issue type, affected page)
export const auditIssues = sqliteTable(
  "audit_issues",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    pageId: text("page_id").references(() => auditPages.id, {
      onDelete: "cascade",
    }),
    pageUrl: text("page_url").notNull(),
    issueType: text("issue_type").notNull(),
    severity: text("severity", { enum: ["critical", "warning", "info"] })
      .notNull()
      .default("info"),
    // JSON details specific to the issue type (e.g. broken link target)
    detailsJson: text("details_json"),
  },
  (table) => [
    index("audit_issues_audit_type_idx").on(table.auditId, table.issueType),
    index("audit_issues_page_id_idx").on(table.pageId),
  ],
);

// One row per Lighthouse test (mobile + desktop per page).
export const auditLighthouseResults = sqliteTable(
  "audit_lighthouse_results",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => auditPages.id, { onDelete: "cascade" }),
    strategy: text("strategy", { enum: ["mobile", "desktop"] }).notNull(),
    performanceScore: integer("performance_score"),
    accessibilityScore: integer("accessibility_score"),
    bestPracticesScore: integer("best_practices_score"),
    seoScore: integer("seo_score"),
    lcpMs: real("lcp_ms"),
    cls: real("cls"),
    inpMs: real("inp_ms"),
    ttfbMs: real("ttfb_ms"),
    errorMessage: text("error_message"),
    r2Key: text("r2_key"),
    payloadSizeBytes: integer("payload_size_bytes"),
  },
  (table) => [
    index("audit_lighthouse_results_audit_id_idx").on(table.auditId),
    index("audit_lighthouse_results_page_id_idx").on(table.pageId),
  ],
);

/**
 * Recurring site audits, at most one schedule per project.
 *
 * Nothing here runs on its own: `schedule_interval` defaults to "manual" and
 * `is_active` to false, so a fresh install — and any project imported from an
 * older deployment — starts with a dormant scheduler. `next_run_at` is the
 * single source of due-ness AND the compare-and-set token the cron claims a
 * slot with, so it is only ever non-null while the schedule is both active and
 * recurring. It stores a UTC ISO instant (never a local wall-clock time), which
 * is what makes the `next_run_at <= now` due check correct for every operator
 * timezone and identical on D1 and Postgres.
 */
export const auditSchedules = sqliteTable(
  "audit_schedules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /**
     * Who armed the schedule. Scheduled audits are attributed to this user, so
     * they also consume that user's per-tier audit capacity — a scheduler
     * cannot mint audits outside the limits its owner is subject to.
     */
    createdByUserId: text("created_by_user_id").notNull(),
    startUrl: text("start_url").notNull(),
    /** Mirrors DEFAULT_AUDIT_PAGES in @/shared/audit-limits. */
    maxPages: integer("max_pages").notNull().default(50),
    lighthouseStrategy: text("lighthouse_strategy", {
      enum: ["auto", "none"],
    })
      .notNull()
      .default("auto"),
    scheduleInterval: text("schedule_interval", {
      enum: ["daily", "weekly", "monthly", "manual"],
    })
      .notNull()
      .default("manual"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    lastRunAt: text("last_run_at"),
    /** Audit started by the most recent scheduled run; links skip/failure UI. */
    lastRunAuditId: text("last_run_audit_id"),
    nextRunAt: text("next_run_at"),
    /** Why the last due tick started nothing; cleared on a successful start. */
    lastSkipReason: text("last_skip_reason"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("audit_schedules_project_id_idx").on(table.projectId),
    index("audit_schedules_due_idx").on(table.isActive, table.nextRunAt),
  ],
);

/**
 * One robots.txt snapshot per audit run. Fetched once during discovery so
 * later slices can read disallowed paths and sitemap directives without
 * re-fetching.
 */
export const auditRobots = sqliteTable(
  "audit_robots",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    found: integer("found", { mode: "boolean" }).notNull().default(false),
    statusCode: integer("status_code"),
    parseError: text("parse_error"),
    hasSitemapDirective: integer("has_sitemap_directive", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [uniqueIndex("audit_robots_audit_id_idx").on(table.auditId)],
);

export const auditRobotsDisallows = sqliteTable(
  "audit_robots_disallows",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    userAgent: text("user_agent").notNull(),
    path: text("path").notNull(),
  },
  (table) => [index("audit_robots_disallows_audit_id_idx").on(table.auditId)],
);

/**
 * One row per sitemap document fetched for an audit (default /sitemap.xml
 * plus any Sitemap: URLs from robots.txt, including nested index children).
 */
export const auditSitemaps = sqliteTable(
  "audit_sitemaps",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    found: integer("found", { mode: "boolean" }).notNull().default(false),
    statusCode: integer("status_code"),
    parseError: text("parse_error"),
    entryCount: integer("entry_count").notNull().default(0),
    byteSize: integer("byte_size").notNull().default(0),
    httpUrlCount: integer("http_url_count").notNull().default(0),
    isIndex: integer("is_index", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    index("audit_sitemaps_audit_id_idx").on(table.auditId),
    uniqueIndex("audit_sitemaps_audit_url_idx").on(table.auditId, table.url),
  ],
);
