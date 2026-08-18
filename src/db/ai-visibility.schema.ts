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

// ============================================================================
// AI visibility tracking
//
// Stateful sibling of rank tracking: a config owns a prompt list, every run
// asks each enabled provider each prompt, and each (run, prompt, provider)
// tuple is persisted as ONE structured observation. Observations record what
// was seen (outcome) and whether we saw it at all (status) as separate
// columns — an "unavailable" provider is not a "brand absent" answer, and
// collapsing the two would silently manufacture visibility trends.
//
// Deliberately absent: any composite "AI visibility score". Providers expose
// no ranking signal comparable to a SERP position, so the stored data is
// limited to observable facts (mention counts, cited sources, cost).
// ============================================================================

/** Providers we can observe. Values match the DataForSEO endpoint families.
 * Kept local to the schema file (mirrored in the Postgres schema) so the table
 * definitions never depend on a non-schema module during drizzle generation. */
const AI_VISIBILITY_PROVIDERS = [
  "chatgpt_search",
  "gemini",
  "google_ai_mode",
] as const;

export const aiVisibilityConfigs = sqliteTable(
  "ai_visibility_configs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Brand string matched against provider answers. */
    brandName: text("brand_name").notNull(),
    /** Domain matched against provider-cited sources. */
    domain: text("domain").notNull(),
    locationCode: integer("location_code").notNull().default(2840),
    languageCode: text("language_code").notNull().default("en"),
    scheduleInterval: text("schedule_interval", {
      enum: ["daily", "weekly", "monthly", "manual"],
    })
      .notNull()
      // Recurring provider spend is opt-in: a new config never bills until a
      // human sets a schedule AND activates it.
      .default("manual"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Approval ceiling in credits for a single run; conservative estimates
     * above it are refused before any provider task is started. */
    maxCostCredits: integer("max_cost_credits"),
    lastRunAt: text("last_run_at"),
    nextRunAt: text("next_run_at"),
    lastSkipReason: text("last_skip_reason"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
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

/**
 * Enabled providers, one row per (config, provider). Presence IS the enabled
 * state — a config with no rows costs nothing to run because there is nothing
 * to ask.
 */
export const aiVisibilityConfigProviders = sqliteTable(
  "ai_visibility_config_providers",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => aiVisibilityConfigs.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: AI_VISIBILITY_PROVIDERS }).notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("ai_visibility_config_providers_config_provider_idx").on(
      table.configId,
      table.provider,
    ),
  ],
);

export const aiVisibilityPrompts = sqliteTable(
  "ai_visibility_prompts",
  {
    id: text("id").primaryKey(),
    configId: text("config_id")
      .notNull()
      .references(() => aiVisibilityConfigs.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("ai_visibility_prompts_config_prompt_idx").on(
      table.configId,
      table.prompt,
    ),
  ],
);

/**
 * One row per run execution. The partial unique index on
 * `config_id WHERE status IN ('pending','running')` is the duplicate-trigger
 * guard, exactly as in rank_check_runs: a failed INSERT is the signal.
 */
export const aiVisibilityRuns = sqliteTable(
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
    /** Provider spend actually metered for this run, in USD. */
    costUsd: real("cost_usd").notNull().default(0),
    maxCostCredits: integer("max_cost_credits"),
    errorMessage: text("error_message"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    completedAt: text("completed_at"),
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

export const aiVisibilityObservations = sqliteTable(
  "ai_visibility_observations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => aiVisibilityRuns.id, { onDelete: "cascade" }),
    // No FK to ai_visibility_prompts — intentional, mirroring rank_snapshots.
    // History survives prompt deletion so trends stay readable.
    trackingPromptId: text("tracking_prompt_id").notNull(),
    prompt: text("prompt").notNull(),
    provider: text("provider", { enum: AI_VISIBILITY_PROVIDERS }).notNull(),
    /** Did we obtain an answer at all? */
    status: text("status", { enum: ["completed", "failed"] }).notNull(),
    /**
     * What the answer said about the brand. `unavailable` is reserved for
     * status='failed' — never conflate a provider outage with brand absence.
     */
    outcome: text("outcome", {
      enum: ["brand_mentioned", "brand_absent", "unavailable"],
    }).notNull(),
    mentionCount: integer("mention_count").notNull().default(0),
    /** Whether the config's domain appeared among the answer's sources. */
    domainCited: integer("domain_cited", { mode: "boolean" }),
    /** Provider model actually used, as reported back by DataForSEO. */
    modelName: text("model_name"),
    /** DataForSEO task id — the audit trail back to the provider. */
    providerTaskId: text("provider_task_id"),
    /** R2 key of the raw provider payload kept as evidence. */
    evidenceR2Key: text("evidence_r2_key"),
    costUsd: real("cost_usd").notNull().default(0),
    errorMessage: text("error_message"),
    checkedAt: text("checked_at")
      .notNull()
      .default(sql`(current_timestamp)`),
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

/** Sources an answer cited, normalized rather than packed into JSON. */
export const aiVisibilityCitations = sqliteTable(
  "ai_visibility_citations",
  {
    id: text("id").primaryKey(),
    observationId: text("observation_id")
      .notNull()
      .references(() => aiVisibilityObservations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    /** Order the source appeared in, 1-based. */
    position: integer("position"),
    isTargetDomain: integer("is_target_domain", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex("ai_visibility_citations_observation_url_idx").on(
      table.observationId,
      table.url,
    ),
  ],
);
