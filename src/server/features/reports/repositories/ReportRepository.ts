import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  reportCommentaryItems,
  reportRuns,
  reportSections,
  reportSettings,
} from "@/db/schema";
import { runBatch } from "@/db/runBatch";
import type {
  ReportCommentaryKind,
  ReportSectionKey,
} from "@/types/schemas/reports";

export const DEFAULT_REPORT_SECTIONS: Array<{
  key: ReportSectionKey;
  enabled: boolean;
}> = [
  { key: "rankings", enabled: true },
  { key: "gsc", enabled: true },
  { key: "ga4", enabled: true },
  { key: "google_ads", enabled: true },
  { key: "audit", enabled: true },
  { key: "backlinks", enabled: true },
  // Stored-data sections: a project with no AI visibility or geo-grid config
  // simply reports them as not connected, so defaulting them on costs nothing
  // and never triggers a provider call.
  { key: "ai_visibility", enabled: true },
  { key: "local_geo_grid", enabled: true },
  { key: "on_page_ideas", enabled: true },
];

async function getSettings(projectId: string) {
  const rows = await db
    .select()
    .from(reportSettings)
    .where(eq(reportSettings.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function getSections(settingsId: string) {
  return db
    .select()
    .from(reportSections)
    .where(eq(reportSections.settingsId, settingsId))
    .orderBy(asc(reportSections.sortOrder));
}

async function createDefaultSettings(input: {
  projectId: string;
  organizationId: string;
  timeZone: string;
  nextRunAt: string;
}) {
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(reportSettings)
    .values({ id, ...input, isEnabled: false })
    .onConflictDoNothing()
    .returning();
  const settings = inserted[0] ?? (await getSettings(input.projectId));
  if (!settings) return null;
  await runBatch((tx) =>
    DEFAULT_REPORT_SECTIONS.map((section, sortOrder) =>
      tx
        .insert(reportSections)
        .values({
          id: crypto.randomUUID(),
          settingsId: settings.id,
          sectionKey: section.key,
          sortOrder,
          isEnabled: section.enabled,
        })
        .onConflictDoNothing(),
    ),
  );
  return settings;
}

async function updateSettings(input: {
  settingsId: string;
  timeZone: string;
  runDay: number;
  runHour: number;
  isEnabled: boolean;
  nextRunAt: string | null;
  sections: Array<{ key: ReportSectionKey; enabled: boolean }>;
}) {
  await runBatch((tx) => [
    tx
      .update(reportSettings)
      .set({
        timeZone: input.timeZone,
        runDay: input.runDay,
        runHour: input.runHour,
        isEnabled: input.isEnabled,
        nextRunAt: input.nextRunAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(reportSettings.id, input.settingsId)),
    tx
      .delete(reportSections)
      .where(eq(reportSections.settingsId, input.settingsId)),
    ...input.sections.map((section, sortOrder) =>
      tx.insert(reportSections).values({
        id: crypto.randomUUID(),
        settingsId: input.settingsId,
        sectionKey: section.key,
        sortOrder,
        isEnabled: section.enabled,
      }),
    ),
  ]);
}

async function createRun(input: {
  id: string;
  projectId: string;
  settingsId: string;
  trigger: "manual" | "scheduled";
  scheduledKey?: string | null;
  workflowInstanceId?: string | null;
  profileId?: string | null;
  periodStart: string;
  periodEnd: string;
  compareStart: string;
  compareEnd: string;
}) {
  const rows = await db
    .insert(reportRuns)
    .values(input)
    .onConflictDoNothing()
    .returning();
  if (rows[0]) return rows[0];
  if (!input.scheduledKey) return null;
  const existing = await db
    .select()
    .from(reportRuns)
    .where(eq(reportRuns.scheduledKey, input.scheduledKey))
    .limit(1);
  return existing[0] ?? null;
}

async function getRun(projectId: string, runId: string) {
  const rows = await db
    .select()
    .from(reportRuns)
    .where(and(eq(reportRuns.id, runId), eq(reportRuns.projectId, projectId)))
    .limit(1);
  return rows[0] ?? null;
}

async function listRuns(projectId: string, publishedOnly: boolean) {
  return db
    .select({
      id: reportRuns.id,
      status: reportRuns.status,
      trigger: reportRuns.trigger,
      periodStart: reportRuns.periodStart,
      periodEnd: reportRuns.periodEnd,
      publishedAt: reportRuns.publishedAt,
      errorMessage: reportRuns.errorMessage,
    })
    .from(reportRuns)
    .where(
      and(
        eq(reportRuns.projectId, projectId),
        publishedOnly ? eq(reportRuns.status, "published") : undefined,
      ),
    )
    .orderBy(desc(reportRuns.periodEnd), desc(reportRuns.createdAt));
}

async function setRunRunning(runId: string, workflowInstanceId?: string) {
  await db
    .update(reportRuns)
    .set({
      status: "running",
      startedAt: new Date().toISOString(),
      workflowInstanceId,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(reportRuns.id, runId));
}

async function setRunWorkflowInstanceId(input: {
  runId: string;
  projectId: string;
  workflowInstanceId: string;
}) {
  const rows = await db
    .update(reportRuns)
    .set({
      workflowInstanceId: input.workflowInstanceId,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(reportRuns.id, input.runId),
        eq(reportRuns.projectId, input.projectId),
      ),
    )
    .returning({ id: reportRuns.id });
  if (!rows[0]) throw new Error("Report run disappeared after workflow start");
}

async function publishRun(input: {
  runId: string;
  snapshotJson: string;
  commentary: Array<{
    kind: ReportCommentaryKind;
    text: string;
    evidenceKey?: string | null;
    isGenerated: boolean;
  }>;
}) {
  const publishedAt = new Date().toISOString();
  await runBatch((tx) => [
    tx
      .update(reportRuns)
      .set({
        status: "published",
        snapshotJson: input.snapshotJson,
        publishedAt,
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(reportRuns.id, input.runId)),
    tx
      .delete(reportCommentaryItems)
      .where(eq(reportCommentaryItems.runId, input.runId)),
    ...input.commentary.map((item, sortOrder) =>
      tx.insert(reportCommentaryItems).values({
        id: crypto.randomUUID(),
        runId: input.runId,
        kind: item.kind,
        text: item.text,
        evidenceKey: item.evidenceKey ?? null,
        sortOrder,
        isGenerated: item.isGenerated,
      }),
    ),
  ]);
}

async function failRun(runId: string, errorMessage: string) {
  await db
    .update(reportRuns)
    .set({
      status: "failed",
      errorMessage: errorMessage.slice(0, 1_000),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(reportRuns.id, runId));
}

async function resetRun(runId: string, projectId: string) {
  const rows = await db
    .update(reportRuns)
    .set({
      status: "queued",
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(reportRuns.id, runId),
        eq(reportRuns.projectId, projectId),
        eq(reportRuns.status, "failed"),
      ),
    )
    .returning({ id: reportRuns.id });
  return Boolean(rows[0]);
}

async function listCommentary(runId: string) {
  return db
    .select()
    .from(reportCommentaryItems)
    .where(eq(reportCommentaryItems.runId, runId))
    .orderBy(asc(reportCommentaryItems.sortOrder));
}

async function replaceCommentary(input: {
  runId: string;
  userId: string;
  items: Array<{
    kind: ReportCommentaryKind;
    text: string;
    evidenceKey?: string | null;
  }>;
}) {
  await runBatch((tx) => [
    tx
      .delete(reportCommentaryItems)
      .where(eq(reportCommentaryItems.runId, input.runId)),
    ...input.items.map((item, sortOrder) =>
      tx.insert(reportCommentaryItems).values({
        id: crypto.randomUUID(),
        runId: input.runId,
        kind: item.kind,
        text: item.text,
        evidenceKey: item.evidenceKey ?? null,
        sortOrder,
        isGenerated: false,
        updatedByUserId: input.userId,
      }),
    ),
  ]);
}

async function listDueSettings(nowIso: string) {
  return db
    .select({
      settings: reportSettings,
      organizationId: projects.organizationId,
    })
    .from(reportSettings)
    .innerJoin(projects, eq(reportSettings.projectId, projects.id))
    .where(
      and(
        eq(reportSettings.isEnabled, true),
        lte(reportSettings.nextRunAt, nowIso),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(reportSettings.nextRunAt))
    .limit(100);
}

async function claimDueSettings(input: {
  settingsId: string;
  observedNextRunAt: string;
  nextRunAt: string;
}) {
  const rows = await db
    .update(reportSettings)
    .set({
      nextRunAt: input.nextRunAt,
      lastRunAt: input.observedNextRunAt,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(reportSettings.id, input.settingsId),
        eq(reportSettings.isEnabled, true),
        eq(reportSettings.nextRunAt, input.observedNextRunAt),
      ),
    )
    .returning({ id: reportSettings.id });
  return Boolean(rows[0]);
}

export const ReportRepository = {
  getSettings,
  getSections,
  createDefaultSettings,
  updateSettings,
  createRun,
  getRun,
  listRuns,
  setRunWorkflowInstanceId,
  setRunRunning,
  publishRun,
  failRun,
  resetRun,
  listCommentary,
  replaceCommentary,
  listDueSettings,
  claimDueSettings,
};
