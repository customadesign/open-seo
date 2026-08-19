/* eslint-disable max-lines -- One SQL boundary for configs, providers, prompts, runs, observations, citations, and the project-scoped dashboard baseline reads. */
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { db } from "@/db";
import {
  aiVisibilityCitations,
  aiVisibilityConfigProviders,
  aiVisibilityConfigs,
  aiVisibilityObservations,
  aiVisibilityPrompts,
  aiVisibilityRuns,
  projects,
} from "@/db/schema";
import { executeInBatches } from "@/db/runBatch";
import type { AiVisibilityProvider } from "@/shared/ai-visibility";
import type { AiVisibilitySkipReason } from "@/shared/ai-visibility";

// Mirrors RankTrackingRepository: one place that speaks SQL, written once for
// SQLite and Postgres through the provider-aware `db` barrel.

// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

async function getConfigsForProject(projectId: string) {
  return db
    .select()
    .from(aiVisibilityConfigs)
    .where(eq(aiVisibilityConfigs.projectId, projectId))
    .orderBy(asc(aiVisibilityConfigs.createdAt));
}

async function getConfigById(input: { configId: string; projectId: string }) {
  const rows = await db
    .select()
    .from(aiVisibilityConfigs)
    .where(
      and(
        eq(aiVisibilityConfigs.id, input.configId),
        eq(aiVisibilityConfigs.projectId, input.projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getConfigByBrand(input: {
  projectId: string;
  brandName: string;
  locationCode: number;
}) {
  const rows = await db
    .select()
    .from(aiVisibilityConfigs)
    .where(
      and(
        eq(aiVisibilityConfigs.projectId, input.projectId),
        eq(aiVisibilityConfigs.brandName, input.brandName),
        eq(aiVisibilityConfigs.locationCode, input.locationCode),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function createConfig(
  data: InferInsertModel<typeof aiVisibilityConfigs>,
) {
  await db.insert(aiVisibilityConfigs).values(data);
}

async function updateConfig(
  configId: string,
  projectId: string,
  data: Partial<InferInsertModel<typeof aiVisibilityConfigs>>,
) {
  await db
    .update(aiVisibilityConfigs)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(aiVisibilityConfigs.id, configId),
        eq(aiVisibilityConfigs.projectId, projectId),
      ),
    );
}

async function deleteConfig(configId: string, projectId: string) {
  await db
    .delete(aiVisibilityConfigs)
    .where(
      and(
        eq(aiVisibilityConfigs.id, configId),
        eq(aiVisibilityConfigs.projectId, projectId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Providers (presence == enabled)
// ---------------------------------------------------------------------------

async function getProvidersForConfig(
  configId: string,
): Promise<AiVisibilityProvider[]> {
  const rows = await db
    .select({ provider: aiVisibilityConfigProviders.provider })
    .from(aiVisibilityConfigProviders)
    .where(eq(aiVisibilityConfigProviders.configId, configId))
    .orderBy(asc(aiVisibilityConfigProviders.provider));
  return rows.map((row) => row.provider);
}

/** Replace the enabled set. An empty list disables every provider. */
async function setProvidersForConfig(
  configId: string,
  providers: readonly AiVisibilityProvider[],
) {
  await db
    .delete(aiVisibilityConfigProviders)
    .where(eq(aiVisibilityConfigProviders.configId, configId));
  if (providers.length === 0) return;
  await executeInBatches(
    providers.map((provider) => ({
      id: crypto.randomUUID(),
      configId,
      provider,
    })),
    (tx, row) => tx.insert(aiVisibilityConfigProviders).values(row),
  );
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

async function getPromptsForConfig(configId: string) {
  return db
    .select()
    .from(aiVisibilityPrompts)
    .where(eq(aiVisibilityPrompts.configId, configId))
    .orderBy(asc(aiVisibilityPrompts.createdAt));
}

async function getActivePromptsForConfig(configId: string) {
  return db
    .select()
    .from(aiVisibilityPrompts)
    .where(
      and(
        eq(aiVisibilityPrompts.configId, configId),
        eq(aiVisibilityPrompts.isActive, true),
      ),
    )
    .orderBy(asc(aiVisibilityPrompts.createdAt));
}

async function addPrompts(
  rows: Array<InferInsertModel<typeof aiVisibilityPrompts>>,
) {
  if (rows.length === 0) return;
  await executeInBatches(rows, (tx, row) =>
    tx
      .insert(aiVisibilityPrompts)
      .values(row)
      .onConflictDoNothing({
        target: [aiVisibilityPrompts.configId, aiVisibilityPrompts.prompt],
      }),
  );
}

async function removePrompts(configId: string, promptIds: string[]) {
  if (promptIds.length === 0) return;
  await db
    .delete(aiVisibilityPrompts)
    .where(
      and(
        eq(aiVisibilityPrompts.configId, configId),
        inArray(aiVisibilityPrompts.id, promptIds),
      ),
    );
}

async function getPromptCountForConfig(configId: string): Promise<number> {
  const rows = await db
    .select({ value: sql<number>`count(*)` })
    .from(aiVisibilityPrompts)
    .where(eq(aiVisibilityPrompts.configId, configId));
  return Number(rows[0]?.value ?? 0);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * Try to insert a pending run. `false` means the partial unique index on
 * (config_id) WHERE status IN ('pending','running') rejected it — another run
 * is already in flight. The failed INSERT *is* the duplicate-trigger guard.
 */
async function tryCreateRun(data: {
  id: string;
  configId: string;
  projectId: string;
  trigger: "manual" | "scheduled";
  observationsTotal: number;
  maxCostCredits?: number | null;
}) {
  const inserted = await db
    .insert(aiVisibilityRuns)
    .values({ ...data, status: "pending" })
    .onConflictDoNothing()
    .returning({ id: aiVisibilityRuns.id });
  return Boolean(inserted[0]);
}

async function updateRun(
  runId: string,
  data: Partial<InferInsertModel<typeof aiVisibilityRuns>>,
) {
  await db
    .update(aiVisibilityRuns)
    .set(data)
    .where(eq(aiVisibilityRuns.id, runId));
}

async function getRunById(runId: string) {
  const rows = await db
    .select()
    .from(aiVisibilityRuns)
    .where(eq(aiVisibilityRuns.id, runId))
    .limit(1);
  return rows[0] ?? null;
}

async function getLatestRunForConfig(configId: string) {
  const rows = await db
    .select()
    .from(aiVisibilityRuns)
    .where(eq(aiVisibilityRuns.configId, configId))
    .orderBy(desc(aiVisibilityRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function getActiveRunForConfig(configId: string) {
  const rows = await db
    .select()
    .from(aiVisibilityRuns)
    .where(
      and(
        eq(aiVisibilityRuns.configId, configId),
        inArray(aiVisibilityRuns.status, ["pending", "running"]),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Observations + citations
// ---------------------------------------------------------------------------

type ObservationInsert = InferInsertModel<typeof aiVisibilityObservations>;
type CitationInsert = InferInsertModel<typeof aiVisibilityCitations>;

/**
 * Persist observations with their citations. Both inserts target their unique
 * index explicitly so a replayed workflow step is idempotent — an untargeted
 * DO NOTHING would also swallow primary-key collisions.
 *
 * Statements are flattened observation-then-its-citations and executed in
 * order, so a citation never lands in a batch that commits before the
 * observation its foreign key points at.
 */
async function insertObservations(
  rows: Array<{
    observation: ObservationInsert;
    citations: Array<Omit<CitationInsert, "observationId">>;
  }>,
) {
  const statements = rows.flatMap<
    | { kind: "observation"; row: ObservationInsert }
    | {
        kind: "citation";
        row: CitationInsert;
      }
  >((row) => [
    { kind: "observation", row: row.observation },
    ...row.citations.map(
      (citation) =>
        ({
          kind: "citation",
          row: { ...citation, observationId: row.observation.id },
        }) as const,
    ),
  ]);
  if (statements.length === 0) return;

  await executeInBatches(statements, (tx, statement) =>
    statement.kind === "observation"
      ? tx
          .insert(aiVisibilityObservations)
          .values(statement.row)
          .onConflictDoNothing({
            target: [
              aiVisibilityObservations.runId,
              aiVisibilityObservations.trackingPromptId,
              aiVisibilityObservations.provider,
            ],
          })
      : tx
          .insert(aiVisibilityCitations)
          .values(statement.row)
          .onConflictDoNothing({
            target: [
              aiVisibilityCitations.observationId,
              aiVisibilityCitations.url,
            ],
          }),
  );
}

async function getObservationsForRun(runId: string) {
  return db
    .select()
    .from(aiVisibilityObservations)
    .where(eq(aiVisibilityObservations.runId, runId));
}

async function getCitationsForRun(runId: string) {
  return db
    .select({
      observationId: aiVisibilityCitations.observationId,
      url: aiVisibilityCitations.url,
      domain: aiVisibilityCitations.domain,
      position: aiVisibilityCitations.position,
      isTargetDomain: aiVisibilityCitations.isTargetDomain,
    })
    .from(aiVisibilityCitations)
    .innerJoin(
      aiVisibilityObservations,
      eq(aiVisibilityCitations.observationId, aiVisibilityObservations.id),
    )
    .where(eq(aiVisibilityObservations.runId, runId))
    .orderBy(asc(aiVisibilityCitations.position));
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

const DUE_CONFIGS_PER_TICK = 200;

async function getDueConfigsWithOrganization(nowIso: string) {
  return db
    .select({
      id: aiVisibilityConfigs.id,
      projectId: aiVisibilityConfigs.projectId,
      brandName: aiVisibilityConfigs.brandName,
      domain: aiVisibilityConfigs.domain,
      locationCode: aiVisibilityConfigs.locationCode,
      languageCode: aiVisibilityConfigs.languageCode,
      scheduleInterval: aiVisibilityConfigs.scheduleInterval,
      maxCostCredits: aiVisibilityConfigs.maxCostCredits,
      nextRunAt: aiVisibilityConfigs.nextRunAt,
      organizationId: projects.organizationId,
    })
    .from(aiVisibilityConfigs)
    .innerJoin(projects, eq(aiVisibilityConfigs.projectId, projects.id))
    .where(
      and(
        eq(aiVisibilityConfigs.isActive, true),
        // A manual config can keep a stale non-null next_run_at; without this
        // it would be selected every tick and never advanced.
        ne(aiVisibilityConfigs.scheduleInterval, "manual"),
        lte(aiVisibilityConfigs.nextRunAt, nowIso),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(aiVisibilityConfigs.nextRunAt), asc(aiVisibilityConfigs.id))
    .limit(DUE_CONFIGS_PER_TICK);
}

/**
 * Conditionally advance a due config's schedule. `next_run_at` equality is the
 * compare-and-set token, so a concurrent edit (or deactivation) loses the
 * claim instead of double-starting a paid run.
 */
async function claimDueConfig(input: {
  configId: string;
  projectId: string;
  observedNextRunAt: string;
  nextRunAt: string;
  lastSkipReason?: AiVisibilitySkipReason | null;
}): Promise<boolean> {
  const claimed = await db
    .update(aiVisibilityConfigs)
    .set({
      nextRunAt: input.nextRunAt,
      ...(input.lastSkipReason !== undefined && {
        lastSkipReason: input.lastSkipReason,
      }),
    })
    .where(
      and(
        eq(aiVisibilityConfigs.id, input.configId),
        eq(aiVisibilityConfigs.projectId, input.projectId),
        eq(aiVisibilityConfigs.isActive, true),
        eq(aiVisibilityConfigs.nextRunAt, input.observedNextRunAt),
      ),
    )
    .returning({ id: aiVisibilityConfigs.id });
  return claimed.length > 0;
}

// ---------------------------------------------------------------------------
// Dashboard baseline reads
//
// The dashboard tracks ONE config per project (the oldest), so these are
// project-scoped rather than config-scoped like the rest of the repository.
// ---------------------------------------------------------------------------

type AiVisibilityRun = typeof aiVisibilityRuns.$inferSelect;
type AiVisibilityFinishedRun = Omit<AiVisibilityRun, "status"> & {
  status: "completed" | "failed";
};
type AiVisibilityObservation = typeof aiVisibilityObservations.$inferSelect;

/** The project's baseline config: oldest wins, so it is stable across visits. */
async function getPrimaryConfigForProject(projectId: string) {
  const rows = await db
    .select()
    .from(aiVisibilityConfigs)
    .where(eq(aiVisibilityConfigs.projectId, projectId))
    .orderBy(asc(aiVisibilityConfigs.createdAt), asc(aiVisibilityConfigs.id))
    .limit(1);
  return rows[0] ?? null;
}

/** Additive: never removes a provider a user deliberately turned off. */
async function addProviders(
  configId: string,
  providers: readonly AiVisibilityProvider[],
) {
  if (providers.length === 0) return;
  await executeInBatches(
    providers.map((provider) => ({
      id: crypto.randomUUID(),
      configId,
      provider,
    })),
    (tx, row) =>
      tx
        .insert(aiVisibilityConfigProviders)
        .values(row)
        .onConflictDoNothing({
          target: [
            aiVisibilityConfigProviders.configId,
            aiVisibilityConfigProviders.provider,
          ],
        }),
  );
}

/**
 * Includes failed runs on purpose: a failed first baseline must read as
 * unavailable rather than looking like it is still collecting forever.
 */
async function getRecentFinishedRuns(
  configId: string,
  limit: number,
): Promise<AiVisibilityFinishedRun[]> {
  const rows = await db
    .select()
    .from(aiVisibilityRuns)
    .where(
      and(
        eq(aiVisibilityRuns.configId, configId),
        inArray(aiVisibilityRuns.status, ["completed", "failed"]),
      ),
    )
    .orderBy(desc(aiVisibilityRuns.startedAt), desc(aiVisibilityRuns.id))
    .limit(limit);
  return rows.filter(
    (run): run is AiVisibilityFinishedRun =>
      run.status === "completed" || run.status === "failed",
  );
}

async function getRecentCompletedRuns(
  configId: string,
  limit: number,
): Promise<AiVisibilityRun[]> {
  return db
    .select()
    .from(aiVisibilityRuns)
    .where(
      and(
        eq(aiVisibilityRuns.configId, configId),
        eq(aiVisibilityRuns.status, "completed"),
      ),
    )
    .orderBy(desc(aiVisibilityRuns.startedAt), desc(aiVisibilityRuns.id))
    .limit(limit);
}

async function getObservationsForRuns(
  runIds: string[],
): Promise<AiVisibilityObservation[]> {
  if (runIds.length === 0) return [];
  return db
    .select()
    .from(aiVisibilityObservations)
    .where(inArray(aiVisibilityObservations.runId, runIds));
}

export const AiVisibilityRepository = {
  getConfigsForProject,
  getConfigById,
  getConfigByBrand,
  getPrimaryConfigForProject,
  addProviders,
  getRecentFinishedRuns,
  getRecentCompletedRuns,
  getObservationsForRuns,
  createConfig,
  updateConfig,
  deleteConfig,
  getProvidersForConfig,
  setProvidersForConfig,
  getPromptsForConfig,
  getActivePromptsForConfig,
  addPrompts,
  removePrompts,
  getPromptCountForConfig,
  tryCreateRun,
  updateRun,
  getRunById,
  getLatestRunForConfig,
  getActiveRunForConfig,
  insertObservations,
  getObservationsForRun,
  getCitationsForRun,
  getDueConfigsWithOrganization,
  claimDueConfig,
};
