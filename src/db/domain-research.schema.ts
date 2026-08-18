import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";

// User-editable brand tokens used to split organic traffic. Derived tokens
// (from the registrable domain) are computed at read time and never stored.

export const domainBrandTokens = sqliteTable(
  "domain_brand_tokens",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    token: text("token").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("domain_brand_tokens_project_domain_token_idx").on(
      table.projectId,
      table.domain,
      table.token,
    ),
    index("domain_brand_tokens_project_domain_idx").on(
      table.projectId,
      table.domain,
    ),
  ],
);

// One monthly header per researched domain + market. Bounded by
// DomainResearchRepository: 6 months retained, 8 domains per project.

export const domainResearchSnapshots = sqliteTable(
  "domain_research_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull(),
    includeSubdomains: integer("include_subdomains").notNull().default(1),
    periodKey: text("period_key").notNull(),
    organicTraffic: integer("organic_traffic"),
    organicKeywords: integer("organic_keywords"),
    trafficCost: real("traffic_cost"),
    capturedAt: text("captured_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("domain_research_snapshots_unique_idx").on(
      table.projectId,
      table.domain,
      table.locationCode,
      table.languageCode,
      table.includeSubdomains,
      table.periodKey,
    ),
    index("domain_research_snapshots_project_captured_idx").on(
      table.projectId,
      table.capturedAt,
    ),
  ],
);

export const domainResearchPages = sqliteTable(
  "domain_research_pages",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => domainResearchSnapshots.id, { onDelete: "cascade" }),
    pageUrl: text("page_url").notNull(),
    organicTraffic: integer("organic_traffic"),
    keywords: integer("keywords"),
  },
  (table) => [
    uniqueIndex("domain_research_pages_snapshot_url_idx").on(
      table.snapshotId,
      table.pageUrl,
    ),
    index("domain_research_pages_snapshot_idx").on(table.snapshotId),
  ],
);

export const domainSerpFeatureMonths = sqliteTable(
  "domain_serp_feature_months",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => domainResearchSnapshots.id, { onDelete: "cascade" }),
    featureType: text("feature_type").notNull(),
    triggeredCount: integer("triggered_count").notNull().default(0),
    occupiedCount: integer("occupied_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("domain_serp_feature_months_snapshot_feature_idx").on(
      table.snapshotId,
      table.featureType,
    ),
    index("domain_serp_feature_months_snapshot_idx").on(table.snapshotId),
  ],
);
