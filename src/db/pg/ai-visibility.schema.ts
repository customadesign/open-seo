import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

// Postgres mirror of ai-visibility.schema.ts. Structural parity (columns in
// the same order, same nullability/defaults/uniques/FKs) is enforced by
// schema-parity.test.ts — read the SQLite file for the design commentary.

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const timestampColumn = (name: string) => text(name);

const AI_VISIBILITY_PROVIDERS = [
  "chatgpt_search",
  "gemini",
  "google_ai_mode",
] as const;

export const aiVisibilityConfigs = pgTable(
  "ai_visibility_configs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    brandName: text("brand_name").notNull(),
    domain: text("domain").notNull(),
    locationCode: integer("location_code").notNull().default(2840),
    languageCode: text("language_code").notNull().default("en"),
    scheduleInterval: text("schedule_interval", {
      enum: ["daily", "weekly", "monthly", "manual"],
    })
      .notNull()
      .default("manual"),
    isActive: boolean("is_active").notNull().default(false),
    maxCostCredits: integer("max_cost_credits"),
    lastRunAt: timestampColumn("last_run_at"),
    nextRunAt: timestampColumn("next_run_at"),
    lastSkipReason: text("last_skip_reason"),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
    updatedAt: timestampColumn("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("ai_visibility_configs_project_brand_location_idx").on(
      table.projectId,
      table.brandName,
      table.locationCode,
    ),
    index("ai_visibility_configs_due_idx").on(table.isActive, table.nextRunAt),
  ],
);

export const aiVisibilityConfigProviders = pgTable(
  "ai_visibility_config_providers",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => aiVisibilityConfigs.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: AI_VISIBILITY_PROVIDERS }).notNull(),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("ai_visibility_config_providers_config_provider_idx").on(
      table.configId,
      table.provider,
    ),
  ],
);

export const aiVisibilityPrompts = pgTable(
  "ai_visibility_prompts",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => aiVisibilityConfigs.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestampColumn("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("ai_visibility_prompts_config_prompt_idx").on(
      table.configId,
      table.prompt,
    ),
  ],
);

export const aiVisibilityRuns = pgTable(
  "ai_visibility_runs",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => aiVisibilityConfigs.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "running", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    trigger: text("trigger", { enum: ["manual", "scheduled"] })
      .notNull()
      .default("manual"),
    observationsTotal: integer("observations_total").notNull().default(0),
    observationsCompleted: integer("observations_completed")
      .notNull()
      .default(0),
    costUsd: real("cost_usd").notNull().default(0),
    maxCostCredits: integer("max_cost_credits"),
    errorMessage: text("error_message"),
    startedAt: timestampColumn("started_at").notNull().default(isoNow),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    index("ai_visibility_runs_config_idx").on(table.configId, table.startedAt),
    index("ai_visibility_runs_project_idx").on(
      table.projectId,
      table.startedAt,
    ),
    uniqueIndex("ai_visibility_runs_one_active_per_config_idx")
      .on(table.configId)
      .where(sql`${table.status} IN ('pending', 'running')`),
  ],
);

export const aiVisibilityObservations = pgTable(
  "ai_visibility_observations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => aiVisibilityRuns.id, { onDelete: "cascade" }),
    trackingPromptId: text("tracking_prompt_id").notNull(),
    prompt: text("prompt").notNull(),
    provider: text("provider", { enum: AI_VISIBILITY_PROVIDERS }).notNull(),
    status: text("status", { enum: ["completed", "failed"] }).notNull(),
    outcome: text("outcome", {
      enum: ["brand_mentioned", "brand_absent", "unavailable"],
    }).notNull(),
    mentionCount: integer("mention_count").notNull().default(0),
    domainCited: boolean("domain_cited"),
    modelName: text("model_name"),
    providerTaskId: text("provider_task_id"),
    evidenceR2Key: text("evidence_r2_key"),
    costUsd: real("cost_usd").notNull().default(0),
    errorMessage: text("error_message"),
    checkedAt: timestampColumn("checked_at").notNull().default(isoNow),
  },
  (table) => [
    index("ai_visibility_observations_prompt_provider_idx").on(
      table.trackingPromptId,
      table.provider,
      table.checkedAt,
    ),
    uniqueIndex("ai_visibility_observations_run_prompt_provider_idx").on(
      table.runId,
      table.trackingPromptId,
      table.provider,
    ),
  ],
);

export const aiVisibilityCitations = pgTable(
  "ai_visibility_citations",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiVisibilityObservations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    position: integer("position"),
    isTargetDomain: boolean("is_target_domain").notNull().default(false),
  },
  (table) => [
    uniqueIndex("ai_visibility_citations_observation_url_idx").on(
      table.observationId,
      table.url,
    ),
  ],
);
