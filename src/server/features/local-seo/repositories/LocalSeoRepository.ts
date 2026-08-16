import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches, runBatch } from "@/db/runBatch";
/* eslint-disable max-lines -- Local SEO writes share cross-table project scoping and atomic batch helpers in one repository boundary. */
import {
  citationAuditRuns,
  citationObservations,
  geoGridCells,
  geoGridConfigs,
  geoGridRuns,
  localBusinessProfiles,
  localListingConnections,
  projects,
} from "@/db/schema";

type ProfileInsert = InferInsertModel<typeof localBusinessProfiles>;
type ListingConnectionInsert = InferInsertModel<typeof localListingConnections>;
type GeoGridConfigInsert = InferInsertModel<typeof geoGridConfigs>;
type GeoGridRunInsert = InferInsertModel<typeof geoGridRuns>;
type GeoGridCellInsert = InferInsertModel<typeof geoGridCells>;
type CitationAuditRunInsert = InferInsertModel<typeof citationAuditRuns>;
type CitationObservationInsert = InferInsertModel<typeof citationObservations>;

const DUE_GEO_GRIDS_PER_TICK = 2;

async function getProfilesForProject(projectId: string) {
  return db
    .select()
    .from(localBusinessProfiles)
    .where(eq(localBusinessProfiles.projectId, projectId))
    .orderBy(
      desc(localBusinessProfiles.isPrimary),
      desc(localBusinessProfiles.updatedAt),
    );
}

async function getProfileById(profileId: string, projectId: string) {
  const rows = await db
    .select()
    .from(localBusinessProfiles)
    .where(
      and(
        eq(localBusinessProfiles.id, profileId),
        eq(localBusinessProfiles.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getPrimaryProfile(projectId: string) {
  const rows = await db
    .select()
    .from(localBusinessProfiles)
    .where(eq(localBusinessProfiles.projectId, projectId))
    .orderBy(
      desc(localBusinessProfiles.isPrimary),
      desc(localBusinessProfiles.updatedAt),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function createProfile(input: ProfileInsert) {
  const [profile] = await db
    .insert(localBusinessProfiles)
    .values(input)
    .returning();
  if (!profile) throw new Error("Failed to create local business profile");
  return profile;
}

async function updateProfile(
  profileId: string,
  projectId: string,
  input: Partial<Omit<ProfileInsert, "id" | "projectId">>,
) {
  const [profile] = await db
    .update(localBusinessProfiles)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(localBusinessProfiles.id, profileId),
        eq(localBusinessProfiles.projectId, projectId),
      ),
    )
    .returning();
  return profile ?? null;
}

/**
 * Promote one profile atomically on both D1 and Postgres. The ordered batch
 * clears the old primary before setting the new one, while the partial unique
 * index remains the final guard against concurrent promotions.
 */
async function savePrimaryProfile(
  input: ProfileInsert & { id: string; projectId: string },
  updating: boolean,
) {
  if (updating && !(await getProfileById(input.id, input.projectId))) {
    return null;
  }
  const values = { ...input, isPrimary: true };
  const updatedAt = new Date().toISOString();
  await runBatch((tx) => [
    tx
      .update(localBusinessProfiles)
      .set({ isPrimary: false, updatedAt })
      .where(
        and(
          eq(localBusinessProfiles.projectId, input.projectId),
          ne(localBusinessProfiles.id, input.id),
          eq(localBusinessProfiles.isPrimary, true),
        ),
      ),
    updating
      ? tx
          .update(localBusinessProfiles)
          .set({ ...values, updatedAt })
          .where(
            and(
              eq(localBusinessProfiles.id, input.id),
              eq(localBusinessProfiles.projectId, input.projectId),
            ),
          )
      : tx.insert(localBusinessProfiles).values(values),
  ]);
  return getProfileById(input.id, input.projectId);
}

async function getListingConnection(profileId: string, projectId: string) {
  const rows = await db
    .select({ connection: localListingConnections })
    .from(localListingConnections)
    .innerJoin(
      localBusinessProfiles,
      eq(localListingConnections.profileId, localBusinessProfiles.id),
    )
    .where(
      and(
        eq(localListingConnections.profileId, profileId),
        eq(localListingConnections.provider, "ghl_listings"),
        eq(localBusinessProfiles.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0]?.connection ?? null;
}

async function upsertListingConnection(
  input: Omit<ListingConnectionInsert, "id" | "provider"> & {
    id?: string;
  },
) {
  const [connection] = await db
    .insert(localListingConnections)
    .values({
      ...input,
      id: input.id ?? crypto.randomUUID(),
      provider: "ghl_listings",
    })
    .onConflictDoUpdate({
      target: [
        localListingConnections.profileId,
        localListingConnections.provider,
      ],
      set: {
        ghlLocationId: input.ghlLocationId,
        engine: input.engine,
        status: input.status,
        statusSource: input.statusSource,
        managementUrl: input.managementUrl,
        lastVerifiedAt: input.lastVerifiedAt,
        lastError: input.lastError,
        updatedAt: new Date().toISOString(),
      },
    })
    .returning();
  if (!connection) throw new Error("Failed to save local listing connection");
  return connection;
}

async function getGeoGridConfigs(projectId: string) {
  return db
    .select()
    .from(geoGridConfigs)
    .where(eq(geoGridConfigs.projectId, projectId))
    .orderBy(desc(geoGridConfigs.updatedAt));
}

async function getGeoGridConfig(configId: string, projectId: string) {
  const rows = await db
    .select()
    .from(geoGridConfigs)
    .where(
      and(
        eq(geoGridConfigs.id, configId),
        eq(geoGridConfigs.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function createGeoGridConfig(input: GeoGridConfigInsert) {
  const [config] = await db.insert(geoGridConfigs).values(input).returning();
  if (!config) throw new Error("Failed to create geo-grid config");
  return config;
}

async function getDueGeoGridConfigs(nowIso: string) {
  return db
    .select({ config: geoGridConfigs, organizationId: projects.organizationId })
    .from(geoGridConfigs)
    .innerJoin(projects, eq(geoGridConfigs.projectId, projects.id))
    .where(
      and(
        eq(geoGridConfigs.isActive, true),
        ne(geoGridConfigs.scheduleInterval, "manual"),
        lte(geoGridConfigs.nextRunAt, nowIso),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(geoGridConfigs.nextRunAt), asc(geoGridConfigs.id))
    .limit(DUE_GEO_GRIDS_PER_TICK);
}

async function claimDueGeoGridConfig(input: {
  configId: string;
  projectId: string;
  observedNextRunAt: string;
  nextRunAt: string;
}) {
  const claimed = await db
    .update(geoGridConfigs)
    .set({
      nextRunAt: input.nextRunAt,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(geoGridConfigs.id, input.configId),
        eq(geoGridConfigs.projectId, input.projectId),
        eq(geoGridConfigs.isActive, true),
        eq(geoGridConfigs.nextRunAt, input.observedNextRunAt),
      ),
    )
    .returning({ id: geoGridConfigs.id });
  return claimed.length > 0;
}

async function getActiveGeoGridRun(configId: string, projectId: string) {
  const rows = await db
    .select()
    .from(geoGridRuns)
    .where(
      and(
        eq(geoGridRuns.configId, configId),
        eq(geoGridRuns.projectId, projectId),
        inArray(geoGridRuns.status, ["pending", "running"]),
      ),
    )
    .orderBy(desc(geoGridRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function createGeoGridRun(input: GeoGridRunInsert) {
  const [run] = await db
    .insert(geoGridRuns)
    .values(input)
    .onConflictDoNothing()
    .returning();
  return run ?? null;
}

async function updateGeoGridRun(
  runId: string,
  projectId: string,
  attemptToken: string,
  input: Partial<Omit<GeoGridRunInsert, "id" | "projectId" | "configId">>,
) {
  const [run] = await db
    .update(geoGridRuns)
    .set(input)
    .where(
      and(
        eq(geoGridRuns.id, runId),
        eq(geoGridRuns.projectId, projectId),
        eq(geoGridRuns.attemptToken, attemptToken),
        inArray(geoGridRuns.status, ["pending", "running"]),
      ),
    )
    .returning();
  return run ?? null;
}

async function failStaleGeoGridRun(input: {
  runId: string;
  projectId: string;
  observedStartedAt: string;
  observedAttemptToken: string;
  observedAttemptStartedAt: string;
  completedAt: string;
}) {
  const [run] = await db
    .update(geoGridRuns)
    .set({
      status: "failed",
      errorMessage:
        "Geo-grid run exceeded the recovery window and was released for retry.",
      completedAt: input.completedAt,
    })
    .where(
      and(
        eq(geoGridRuns.id, input.runId),
        eq(geoGridRuns.projectId, input.projectId),
        eq(geoGridRuns.startedAt, input.observedStartedAt),
        eq(geoGridRuns.attemptToken, input.observedAttemptToken),
        eq(geoGridRuns.attemptStartedAt, input.observedAttemptStartedAt),
        inArray(geoGridRuns.status, ["pending", "running"]),
      ),
    )
    .returning();
  return run ?? null;
}

async function markGeoGridConfigRun(
  configId: string,
  projectId: string,
  completedAt: string,
) {
  await db
    .update(geoGridConfigs)
    .set({ lastRunAt: completedAt, updatedAt: completedAt })
    .where(
      and(
        eq(geoGridConfigs.id, configId),
        eq(geoGridConfigs.projectId, projectId),
      ),
    );
}

async function insertGeoGridCellClaimed(input: {
  cell: GeoGridCellInsert;
  projectId: string;
  attemptToken: string;
}) {
  const cell = input.cell;
  const checkedAt = cell.checkedAt ?? new Date().toISOString();
  const selectedCell = db
    .select({
      id: sql<string>`${cell.id}`.as("id"),
      runId: sql<string>`${cell.runId}`.as("run_id"),
      rowIndex: sql<number>`${cell.rowIndex}`.as("row_index"),
      columnIndex: sql<number>`${cell.columnIndex}`.as("column_index"),
      latitude: sql<number>`${cell.latitude}`.as("latitude"),
      longitude: sql<number>`${cell.longitude}`.as("longitude"),
      position: sql<number | null>`${cell.position ?? null}`.as("position"),
      matchedBy: sql<NonNullable<GeoGridCellInsert["matchedBy"]>>`${
        cell.matchedBy ?? "none"
      }`.as("matched_by"),
      resultTitle: sql<string | null>`${cell.resultTitle ?? null}`.as(
        "result_title",
      ),
      resultUrl: sql<string | null>`${cell.resultUrl ?? null}`.as("result_url"),
      providerResultId: sql<string | null>`${cell.providerResultId ?? null}`.as(
        "provider_result_id",
      ),
      checkedAt: sql<string>`${checkedAt}`.as("checked_at"),
    })
    .from(geoGridRuns)
    .where(
      and(
        eq(geoGridRuns.id, cell.runId),
        eq(geoGridRuns.projectId, input.projectId),
        eq(geoGridRuns.attemptToken, input.attemptToken),
        inArray(geoGridRuns.status, ["pending", "running"]),
      ),
    );
  const [inserted] = await db
    .insert(geoGridCells)
    .select(selectedCell)
    .onConflictDoNothing()
    .returning({ id: geoGridCells.id });
  return inserted ?? null;
}

async function getGeoGridRuns(
  projectId: string,
  options: { configId?: string; limit: number },
) {
  return db
    .select()
    .from(geoGridRuns)
    .where(
      and(
        eq(geoGridRuns.projectId, projectId),
        options.configId == null
          ? undefined
          : eq(geoGridRuns.configId, options.configId),
      ),
    )
    .orderBy(desc(geoGridRuns.startedAt), desc(geoGridRuns.id))
    .limit(options.limit);
}

async function getLatestFailedGeoGridRun(configId: string, projectId: string) {
  const rows = await db
    .select()
    .from(geoGridRuns)
    .where(
      and(
        eq(geoGridRuns.configId, configId),
        eq(geoGridRuns.projectId, projectId),
        eq(geoGridRuns.status, "failed"),
      ),
    )
    .orderBy(desc(geoGridRuns.startedAt), desc(geoGridRuns.id))
    .limit(1);
  return rows[0] ?? null;
}

async function claimFailedGeoGridRun(input: {
  runId: string;
  configId: string;
  projectId: string;
  observedStartedAt: string;
  observedCompletedAt: string;
  observedAttemptToken: string;
  attemptToken: string;
  attemptStartedAt: string;
}) {
  const [run] = await db
    .update(geoGridRuns)
    .set({
      status: "running",
      attemptToken: input.attemptToken,
      attemptStartedAt: input.attemptStartedAt,
      errorMessage: null,
      completedAt: null,
    })
    .where(
      and(
        eq(geoGridRuns.id, input.runId),
        eq(geoGridRuns.configId, input.configId),
        eq(geoGridRuns.projectId, input.projectId),
        eq(geoGridRuns.status, "failed"),
        eq(geoGridRuns.startedAt, input.observedStartedAt),
        eq(geoGridRuns.completedAt, input.observedCompletedAt),
        eq(geoGridRuns.attemptToken, input.observedAttemptToken),
      ),
    )
    .returning();
  return run ?? null;
}

async function getGeoGridRun(runId: string, projectId: string) {
  const rows = await db
    .select()
    .from(geoGridRuns)
    .where(and(eq(geoGridRuns.id, runId), eq(geoGridRuns.projectId, projectId)))
    .limit(1);
  return rows[0] ?? null;
}

async function getGeoGridCells(runId: string, projectId: string) {
  const run = await getGeoGridRun(runId, projectId);
  if (!run) return [];
  return db
    .select()
    .from(geoGridCells)
    .where(eq(geoGridCells.runId, runId))
    .orderBy(geoGridCells.rowIndex, geoGridCells.columnIndex);
}

async function createCitationAuditRun(input: CitationAuditRunInsert) {
  const [run] = await db.insert(citationAuditRuns).values(input).returning();
  if (!run) throw new Error("Failed to create citation audit run");
  return run;
}

async function updateCitationAuditRun(
  runId: string,
  projectId: string,
  input: Partial<
    Omit<CitationAuditRunInsert, "id" | "projectId" | "profileId">
  >,
) {
  const [run] = await db
    .update(citationAuditRuns)
    .set(input)
    .where(
      and(
        eq(citationAuditRuns.id, runId),
        eq(citationAuditRuns.projectId, projectId),
      ),
    )
    .returning();
  return run ?? null;
}

async function insertCitationObservations(
  observations: CitationObservationInsert[],
) {
  await executeInBatches(observations, (tx, observation) =>
    tx.insert(citationObservations).values(observation),
  );
}

async function getCitationAuditRuns(
  projectId: string,
  options: { profileId?: string; limit: number },
) {
  return db
    .select()
    .from(citationAuditRuns)
    .where(
      and(
        eq(citationAuditRuns.projectId, projectId),
        options.profileId == null
          ? undefined
          : eq(citationAuditRuns.profileId, options.profileId),
      ),
    )
    .orderBy(desc(citationAuditRuns.startedAt), desc(citationAuditRuns.id))
    .limit(options.limit);
}

async function getCitationAuditRun(runId: string, projectId: string) {
  const rows = await db
    .select()
    .from(citationAuditRuns)
    .where(
      and(
        eq(citationAuditRuns.id, runId),
        eq(citationAuditRuns.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getCitationObservations(runId: string, projectId: string) {
  const run = await getCitationAuditRun(runId, projectId);
  if (!run) return [];
  return db
    .select()
    .from(citationObservations)
    .where(eq(citationObservations.auditRunId, runId))
    .orderBy(citationObservations.directoryKey, citationObservations.sourceUrl);
}

export const LocalSeoRepository = {
  getProfilesForProject,
  getProfileById,
  getPrimaryProfile,
  createProfile,
  updateProfile,
  savePrimaryProfile,
  getListingConnection,
  upsertListingConnection,
  getGeoGridConfigs,
  getGeoGridConfig,
  createGeoGridConfig,
  getDueGeoGridConfigs,
  claimDueGeoGridConfig,
  getActiveGeoGridRun,
  createGeoGridRun,
  updateGeoGridRun,
  failStaleGeoGridRun,
  markGeoGridConfigRun,
  insertGeoGridCellClaimed,
  getGeoGridRuns,
  getLatestFailedGeoGridRun,
  claimFailedGeoGridRun,
  getGeoGridRun,
  getGeoGridCells,
  createCitationAuditRun,
  updateCitationAuditRun,
  insertCitationObservations,
  getCitationAuditRuns,
  getCitationAuditRun,
  getCitationObservations,
} as const;
