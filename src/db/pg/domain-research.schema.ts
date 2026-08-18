import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const domainBrandTokens = pgTable(
  "domain_brand_tokens",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    token: text("token").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
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

export const domainResearchSnapshots = pgTable(
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
    capturedAt: text("captured_at").notNull().default(isoNow),
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

export const domainResearchPages = pgTable(
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

export const domainSerpFeatureMonths = pgTable(
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
