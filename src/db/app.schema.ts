/* eslint-disable max-lines -- the D1 schema catalog stays in one file for Drizzle generation and SQLite/Postgres parity review. */
import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { member, organization, user } from "./better-auth-schema";

export const userOnboardingAnswers = sqliteTable(
  "user_onboarding_answers",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    interestedFeatures: text("interested_features").notNull().default("[]"),
    workFor: text("work_for"),
    clientWebsiteCount: text("client_website_count"),
    foundVia: text("found_via"),
    mcpSetupIntent: text("mcp_setup_intent"),
    completedAt: text("completed_at"),
    // Set when the user resolves the Search Console ask, either in current
    // onboarding or via the one-time re-engagement nudge for legacy users.
    // Null = not yet shown/resolved.
    gscNudgeDismissedAt: text("gsc_nudge_dismissed_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("user_onboarding_answers_organization_idx").on(table.organizationId),
  ],
);

// Projects for keyword research
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain"),
    // Default DataForSEO location/language for the project, set during
    // onboarding and reused by every project-scoped data call.
    locationCode: integer("location_code").notNull().default(2840),
    languageCode: text("language_code").notNull().default("en"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    // Soft delete: archived projects are hidden everywhere but their data
    // (keywords, rank tracking, audits) is preserved.
    archivedAt: text("archived_at"),
  },
  (table) => [
    // Only the auto-created Default/null-domain project is a singleton. This
    // guards the get-or-create race that can happen when several requests enter
    // a new organization at once, without forbidding users from manually
    // creating multiple projects with the same name or domain later.
    uniqueIndex("projects_one_default_per_organization_idx")
      .on(table.organizationId)
      .where(
        sql`${table.name} = 'Default' AND ${table.domain} IS NULL AND ${table.archivedAt} IS NULL`,
      ),
    // Every project listing filters by organization; the partial-unique index
    // above only covers the Default-project row, so without this the org-scoped
    // list queries seq-scan. Per-org row counts are small, so the archived/
    // created_at ordering sorts cheaply on top of this single-column lookup.
    index("projects_organization_id_idx").on(table.organizationId),
  ],
);

// Hosted workspace access attached to a Better Auth organization member.
// Owners are derived from member.role and need no profile row. A missing row
// for a non-owner is treated as a legacy employee with all-project access.
export const memberAccessProfiles = sqliteTable(
  "member_access_profiles",
  {
    memberId: text("member_id")
      .primaryKey()
      .references(() => member.id, { onDelete: "cascade" }),
    accountType: text("account_type", { enum: ["employee", "client"] })
      .notNull()
      .default("employee"),
    projectScope: text("project_scope", { enum: ["all", "selected"] })
      .notNull()
      .default("all"),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("member_access_profiles_status_idx").on(table.status)],
);

export const projectMemberAccess = sqliteTable(
  "project_member_access",
  {
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.projectId] }),
    index("project_member_access_project_idx").on(table.projectId),
  ],
);

// User-saved keywords within a project. This is the canonical saved list.
export const savedKeywords = sqliteTable(
  "saved_keywords",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull().default(2840),
    languageCode: text("language_code").notNull().default("en"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("saved_keywords_unique_project_keyword_location_language").on(
      table.projectId,
      table.keyword,
      table.locationCode,
      table.languageCode,
    ),
    index("saved_keywords_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const savedKeywordTags = sqliteTable(
  "saved_keyword_tags",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    // Palette key (e.g. "blue", "rose"). Null = derive a stable color from the
    // tag id at render time. See src/shared/tag-colors.ts.
    color: text("color"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("saved_keyword_tags_project_normalized_name_idx").on(
      table.projectId,
      table.normalizedName,
    ),
    index("saved_keyword_tags_project_name_idx").on(
      table.projectId,
      table.name,
    ),
  ],
);

export const savedKeywordTagAssignments = sqliteTable(
  "saved_keyword_tag_assignments",
  {
    savedKeywordId: text("saved_keyword_id")
      .notNull()
      .references(() => savedKeywords.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => savedKeywordTags.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("saved_keyword_tag_assignments_unique_idx").on(
      table.savedKeywordId,
      table.tagId,
    ),
    // No standalone index on savedKeywordId — the unique index above has it as
    // its leftmost column, so it already serves savedKeywordId lookups.
    index("saved_keyword_tag_assignments_tag_idx").on(table.tagId),
  ],
);

// Latest cached metrics for a keyword within a project.
// This is joined onto savedKeywords when rendering the saved keyword list.
export const keywordMetrics = sqliteTable(
  "keyword_metrics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull().default("en"),
    searchVolume: integer("search_volume"),
    cpc: real("cpc"),
    competition: real("competition"),
    keywordDifficulty: integer("keyword_difficulty"),
    intent: text("intent"),
    monthlySearches: text("monthly_searches"),
    fetchedAt: text("fetched_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("keyword_metrics_unique_project_keyword_location_language").on(
      table.projectId,
      table.keyword,
      table.locationCode,
      table.languageCode,
    ),
    index("keyword_metrics_lookup_idx").on(
      table.projectId,
      table.keyword,
      table.locationCode,
      table.languageCode,
      table.fetchedAt,
    ),
  ],
);

// Dashboard activation milestones. Organization-scoped: MCP OAuth grants are
// user-level, so any member connecting an external MCP client satisfies the
// milestone for the whole organization. Timestamps are first-occurrence only
// and never move once set.
export const organizationActivationState = sqliteTable(
  "organization_activation_state",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    firstMcpAuthorizedAt: text("first_mcp_authorized_at"),
    firstMcpToolCallAt: text("first_mcp_tool_call_at"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
);

// Per-project state for the dashboard's onboarding checklist. Most steps
// complete via real product state (projects.domain, gsc_connections, MCP
// activation); the competitor step completes on click-through.
export const projectActivationState = sqliteTable("project_activation_state", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  competitorStepClickedAt: text("competitor_step_clicked_at"),
  // "I already connected" on the MCP card: hides the card for this project
  // without faking the org-level first-tool-call milestone, which stays
  // truthful and self-heals when a real external call lands.
  mcpCardDismissedAt: text("mcp_card_dismissed_at"),
  // Optional integration pitch: hiding it from the dashboard does not remove
  // the GA4 connection controls from Project Settings.
  ga4CardDismissedAt: text("ga4_card_dismissed_at"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

// Point-in-time backlink profile summaries for the project's own domain,
// written by the dashboard's visit-triggered refresh. DataForSEO's summary
// already carries new/lost counts, so one snapshot renders a full card;
// rows accumulate into history for future trend views. The domain is stored
// per row so a later project-domain change doesn't rewrite history.
export const backlinkSnapshots = sqliteTable(
  "backlink_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    rank: integer("rank"),
    backlinks: integer("backlinks"),
    referringDomains: integer("referring_domains"),
    brokenBacklinks: integer("broken_backlinks"),
    newBacklinks: integer("new_backlinks"),
    lostBacklinks: integer("lost_backlinks"),
    newReferringDomains: integer("new_referring_domains"),
    lostReferringDomains: integer("lost_referring_domains"),
    capturedAt: text("captured_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("backlink_snapshots_project_captured_idx").on(
      table.projectId,
      table.capturedAt,
    ),
  ],
);

// Daily history of the DataForSEO domain overview (estimated organic traffic and
// ranked-keyword count). Normalized rather than a JSON blob so trends can be
// queried, and persisted rather than read from the R2 response cache so the
// dashboard can show a delta without re-paying for yesterday's numbers.
export const domainOverviewSnapshots = sqliteTable(
  "domain_overview_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    /** DataForSEO `metrics.organic.etv`, rounded. */
    organicTraffic: integer("organic_traffic"),
    /** DataForSEO `metrics.organic.count`, rounded. */
    organicKeywords: integer("organic_keywords"),
    capturedAt: text("captured_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("domain_overview_snapshots_project_captured_idx").on(
      table.projectId,
      table.capturedAt,
    ),
  ],
);
