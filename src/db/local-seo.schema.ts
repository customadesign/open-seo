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

export const localBusinessProfiles = sqliteTable(
  "local_business_profiles",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    locality: text("locality").notNull(),
    region: text("region").notNull(),
    postalCode: text("postal_code").notNull(),
    countryCode: text("country_code").notNull(),
    phone: text("phone").notNull(),
    websiteUrl: text("website_url").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    googlePlaceId: text("google_place_id"),
    googleCid: text("google_cid"),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    verifiedAt: text("verified_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("local_business_profiles_project_idx").on(table.projectId),
    uniqueIndex("local_business_profiles_one_primary_per_project_idx")
      .on(table.projectId)
      .where(sql`${table.isPrimary} = true`),
    uniqueIndex("local_business_profiles_project_place_idx")
      .on(table.projectId, table.googlePlaceId)
      .where(sql`${table.googlePlaceId} IS NOT NULL`),
  ],
);

export const localListingConnections = sqliteTable(
  "local_listing_connections",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => localBusinessProfiles.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["ghl_listings"] })
      .notNull()
      .default("ghl_listings"),
    ghlLocationId: text("ghl_location_id").notNull(),
    engine: text("engine", { enum: ["yext", "uberall", "unknown"] })
      .notNull()
      .default("unknown"),
    status: text("status", {
      enum: [
        "not_connected",
        "setup_required",
        "provisioning",
        "active",
        "attention_required",
        "canceled",
        "unavailable",
      ],
    })
      .notNull()
      .default("setup_required"),
    statusSource: text("status_source", {
      enum: ["api", "manual", "audit"],
    })
      .notNull()
      .default("manual"),
    managementUrl: text("management_url").notNull(),
    lastVerifiedAt: text("last_verified_at"),
    lastError: text("last_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("local_listing_connections_profile_provider_idx").on(
      table.profileId,
      table.provider,
    ),
    index("local_listing_connections_ghl_location_idx").on(table.ghlLocationId),
  ],
);

export const geoGridConfigs = sqliteTable(
  "geo_grid_configs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => localBusinessProfiles.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    centerLatitude: real("center_latitude").notNull(),
    centerLongitude: real("center_longitude").notNull(),
    gridSize: integer("grid_size").notNull().default(5),
    radiusMeters: integer("radius_meters").notNull().default(5000),
    languageCode: text("language_code").notNull().default("en"),
    device: text("device", { enum: ["desktop", "mobile"] })
      .notNull()
      .default("mobile"),
    scheduleInterval: text("schedule_interval", {
      enum: ["manual", "daily", "weekly", "monthly"],
    })
      .notNull()
      .default("manual"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("geo_grid_configs_profile_keyword_idx").on(
      table.profileId,
      table.keyword,
    ),
    index("geo_grid_configs_project_due_idx").on(
      table.projectId,
      table.isActive,
      table.nextRunAt,
    ),
  ],
);

export const geoGridRuns = sqliteTable(
  "geo_grid_runs",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => geoGridConfigs.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    attemptToken: text("attempt_token").notNull().default(""),
    attemptStartedAt: text("attempt_started_at").notNull().default(""),
    gridSize: integer("grid_size").notNull(),
    radiusMeters: integer("radius_meters").notNull(),
    cellsTotal: integer("cells_total").notNull(),
    cellsCompleted: integer("cells_completed").notNull().default(0),
    averageRank: real("average_rank"),
    topThreeCoverage: real("top_three_coverage"),
    topTenCoverage: real("top_ten_coverage"),
    topTwentyCoverage: real("top_twenty_coverage"),
    costUsd: real("cost_usd"),
    errorMessage: text("error_message"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("geo_grid_runs_one_active_per_config_idx")
      .on(table.configId)
      .where(sql`${table.status} IN ('pending', 'running')`),
    index("geo_grid_runs_config_started_idx").on(
      table.configId,
      table.startedAt,
    ),
    index("geo_grid_runs_project_started_idx").on(
      table.projectId,
      table.startedAt,
    ),
  ],
);

export const geoGridCells = sqliteTable(
  "geo_grid_cells",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => geoGridRuns.id, { onDelete: "cascade" }),
    rowIndex: integer("row_index").notNull(),
    columnIndex: integer("column_index").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    position: integer("position"),
    matchedBy: text("matched_by", {
      enum: ["place_id", "cid", "phone", "domain", "name", "none"],
    })
      .notNull()
      .default("none"),
    resultTitle: text("result_title"),
    resultUrl: text("result_url"),
    providerResultId: text("provider_result_id"),
    checkedAt: text("checked_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("geo_grid_cells_run_coordinate_idx").on(
      table.runId,
      table.rowIndex,
      table.columnIndex,
    ),
  ],
);

export const citationAuditRuns = sqliteTable(
  "citation_audit_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => localBusinessProfiles.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["running", "completed", "failed"],
    })
      .notNull()
      .default("running"),
    observationsTotal: integer("observations_total").notNull().default(0),
    confirmedMatches: integer("confirmed_matches").notNull().default(0),
    confirmedMismatches: integer("confirmed_mismatches").notNull().default(0),
    foundUnverified: integer("found_unverified").notNull().default(0),
    notFound: integer("not_found").notNull().default(0),
    blocked: integer("blocked").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("citation_audit_runs_project_started_idx").on(
      table.projectId,
      table.startedAt,
    ),
    index("citation_audit_runs_profile_started_idx").on(
      table.profileId,
      table.startedAt,
    ),
  ],
);

export const citationObservations = sqliteTable(
  "citation_observations",
  {
    id: text("id").primaryKey(),
    auditRunId: text("audit_run_id")
      .notNull()
      .references(() => citationAuditRuns.id, { onDelete: "cascade" }),
    directoryKey: text("directory_key").notNull(),
    sourceUrl: text("source_url"),
    status: text("status", {
      enum: [
        "confirmed_match",
        "confirmed_mismatch",
        "found_unverified",
        "not_found",
        "blocked",
      ],
    }).notNull(),
    observedName: text("observed_name"),
    observedAddress: text("observed_address"),
    observedPhone: text("observed_phone"),
    observedWebsiteUrl: text("observed_website_url"),
    nameMatches: integer("name_matches", { mode: "boolean" }),
    addressMatches: integer("address_matches", { mode: "boolean" }),
    phoneMatches: integer("phone_matches", { mode: "boolean" }),
    websiteMatches: integer("website_matches", { mode: "boolean" }),
    evidenceNote: text("evidence_note"),
    errorCode: text("error_code"),
    checkedAt: text("checked_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("citation_observations_run_status_idx").on(
      table.auditRunId,
      table.status,
    ),
    uniqueIndex("citation_observations_run_directory_url_idx").on(
      table.auditRunId,
      table.directoryKey,
      table.sourceUrl,
    ),
  ],
);
