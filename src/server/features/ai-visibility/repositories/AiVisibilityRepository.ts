import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { db } from "@/db";
import {
  aiVisibilityCitations,
  aiVisibilityConfigProviders,
  aiVisibilityConfigs,
  aiVisibilityObservations,
  aiVisibilityPrompts,
  aiVisibilityRuns,
} from "@/db/schema";
import { executeInBatches } from "@/db/runBatch";
import type { AiVisibilityProvider } from "@/shared/ai-visibility";

// Mirrors RankTrackingRepository: one place that speaks SQL, written once for
// SQLite and Postgres through the provider-aware `db` barrel.

type AiVisibilityRun = typeof aiVisibilityRuns.$inferSelect;
type AiVisibilityFinishedRun = Omit<AiVisibilityRun, "status"> & {
  status: "completed" | "failed";
};
type AiVisibilityObservation = typeof aiVisibilityObservations.$inferSelect;

type ObservationInsert = InferInsertModel<typeof aiVisibilityObservations>;
type CitationInsert = InferInsertModel<typeof aiVisibilityCitations>;

// ---------------------------------------------------------------------------
// Config, providers, prompts
// ---------------------------------------------------------------------------

/**
 * The project's tracked config. Seeding creates exactly one per project, and
 * `createdAt` order keeps that stable if a second is ever added by hand.
 */
async function getPrimaryConfigForProject(projectId: string) {
  const rows = await db
    .select()
    .from(aiVisibilityConfigs)
    .where(eq(aiVisibilityConfigs.projectId, projectId))
    .orderBy(asc(aiVisibilityConfigs.createdAt), asc(aiVisibilityConfigs.id))
    .limit(1);
  return rows[0] ?? null;
}

async function createConfig(
  data: InferInsertModel<typeof aiVisibilityConfigs>,
) {
  await db
    .insert(aiVisibilityConfigs)
    .values(data)
    .onConflictDoNothing({
      target: [
        aiVisibilityConfigs.projectId,
        aiVisibilityConfigs.brandName,
        aiVisibilityConfigs.locationCode,
      ],
    });
}

async function updateConfig(
  configId: string,
  data: Partial<InferInsertModel<typeof aiVisibilityConfigs>>,
) {
  await db
    .update(aiVisibilityConfigs)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(aiVisibilityConfigs.id, configId));
}

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

/** Additive: seeding must never disable a provider a user turned off by hand. */
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
    .orderBy(asc(aiVisibilityPrompts.createdAt), asc(aiVisibilityPrompts.id));
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
}): Promise<boolean> {
  const inserted = await db
    .insert(aiVisibilityRuns)
    .values({ ...data, status: "running" })
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

/**
 * Fail an unfinished run without changing one that a concurrent worker already
 * finalized. The conditional update keeps an uncertain write failure from
 * turning a successfully completed run back into a failure.
 */
async function markRunFailed(runId: string, errorMessage: string) {
  await db
    .update(aiVisibilityRuns)
    .set({
      status: "failed",
      errorMessage,
      completedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(aiVisibilityRuns.id, runId),
        inArray(aiVisibilityRuns.status, ["pending", "running"]),
      ),
    );
}

async function getActiveRunForConfig(
  configId: string,
): Promise<AiVisibilityRun | null> {
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

/** Newest first. Two rows is what the dashboard needs: latest and its delta. */
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

/** Newest terminal runs, including failures, scoped to one config. */
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

// ---------------------------------------------------------------------------
// Observations + citations
// ---------------------------------------------------------------------------

/**
 * Persist observations with their citations. Both inserts target their unique
 * index explicitly so a retried run is idempotent — an untargeted DO NOTHING
 * would also swallow primary-key collisions.
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
    | { kind: "citation"; row: CitationInsert }
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
  getPrimaryConfigForProject,
  createConfig,
  updateConfig,
  getProvidersForConfig,
  addProviders,
  getActivePromptsForConfig,
  addPrompts,
  tryCreateRun,
  updateRun,
  markRunFailed,
  getActiveRunForConfig,
  getRecentCompletedRuns,
  getRecentFinishedRuns,
  insertObservations,
  getObservationsForRuns,
};
