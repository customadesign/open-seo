import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  projects,
  reportArtifacts,
  reportDeliveries,
  reportRecipients,
  reportRuns,
  reportSchedules,
  reportShareLinks,
  reportTemplateSections,
  reportTemplates,
} from "@/db/schema";

type ReportRunStatus = (typeof reportRuns.status.enumValues)[number];
type ReportRun = typeof reportRuns.$inferSelect;
type ReportDelivery = typeof reportDeliveries.$inferSelect;

function templateProjectScope(projectId: string) {
  return or(
    eq(reportTemplates.projectId, projectId),
    isNull(reportTemplates.projectId),
  );
}

async function listTemplates(organizationId: string, projectId: string) {
  return db
    .select()
    .from(reportTemplates)
    .where(
      and(
        eq(reportTemplates.organizationId, organizationId),
        templateProjectScope(projectId),
      ),
    )
    .orderBy(desc(reportTemplates.isDefault), asc(reportTemplates.name));
}

async function getTemplateScoped(input: {
  templateId: string;
  organizationId: string;
  projectId: string;
}) {
  const [row] = await db
    .select()
    .from(reportTemplates)
    .where(
      and(
        eq(reportTemplates.id, input.templateId),
        eq(reportTemplates.organizationId, input.organizationId),
        templateProjectScope(input.projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function getTemplateSections(templateId: string) {
  return db
    .select()
    .from(reportTemplateSections)
    .where(eq(reportTemplateSections.templateId, templateId))
    .orderBy(asc(reportTemplateSections.sortOrder));
}

async function createTemplate(
  values: InferInsertModel<typeof reportTemplates>,
  sections: Array<InferInsertModel<typeof reportTemplateSections>>,
) {
  await runBatch((tx) => [
    tx.insert(reportTemplates).values(values),
    ...sections.map((section) =>
      tx.insert(reportTemplateSections).values(section),
    ),
  ]);
  return values.id;
}

async function listSchedules(organizationId: string, projectId: string) {
  return db
    .select({ schedule: reportSchedules, templateName: reportTemplates.name })
    .from(reportSchedules)
    .innerJoin(
      reportTemplates,
      eq(reportSchedules.templateId, reportTemplates.id),
    )
    .where(
      and(
        eq(reportSchedules.projectId, projectId),
        eq(reportTemplates.organizationId, organizationId),
        templateProjectScope(projectId),
      ),
    )
    .orderBy(desc(reportSchedules.createdAt), desc(reportSchedules.id));
}

async function getScheduleScoped(input: {
  scheduleId: string;
  organizationId: string;
  projectId: string;
}) {
  const [row] = await db
    .select({ schedule: reportSchedules, template: reportTemplates })
    .from(reportSchedules)
    .innerJoin(
      reportTemplates,
      eq(reportSchedules.templateId, reportTemplates.id),
    )
    .where(
      and(
        eq(reportSchedules.id, input.scheduleId),
        eq(reportSchedules.projectId, input.projectId),
        eq(reportTemplates.organizationId, input.organizationId),
        templateProjectScope(input.projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function createSchedule(
  values: InferInsertModel<typeof reportSchedules>,
  recipients: Array<InferInsertModel<typeof reportRecipients>>,
) {
  await runBatch((tx) => [
    tx.insert(reportSchedules).values(values),
    ...recipients.map((recipient) =>
      tx.insert(reportRecipients).values(recipient),
    ),
  ]);
  return values.id;
}

async function listRecipients(scheduleId: string) {
  return db
    .select()
    .from(reportRecipients)
    .where(eq(reportRecipients.scheduleId, scheduleId))
    .orderBy(asc(reportRecipients.email));
}

async function listRuns(organizationId: string, projectId: string) {
  return db
    .select({ run: reportRuns, templateName: reportTemplates.name })
    .from(reportRuns)
    .innerJoin(reportTemplates, eq(reportRuns.templateId, reportTemplates.id))
    .innerJoin(projects, eq(reportRuns.projectId, projects.id))
    .where(
      and(
        eq(reportRuns.projectId, projectId),
        eq(projects.organizationId, organizationId),
        eq(reportTemplates.organizationId, organizationId),
        templateProjectScope(projectId),
      ),
    )
    .orderBy(desc(reportRuns.startedAt), desc(reportRuns.id))
    .limit(50);
}

async function getRunScoped(input: {
  runId: string;
  organizationId: string;
  projectId: string;
}) {
  const [row] = await db
    .select({ run: reportRuns, template: reportTemplates, project: projects })
    .from(reportRuns)
    .innerJoin(reportTemplates, eq(reportRuns.templateId, reportTemplates.id))
    .innerJoin(projects, eq(reportRuns.projectId, projects.id))
    .where(
      and(
        eq(reportRuns.id, input.runId),
        eq(reportRuns.projectId, input.projectId),
        eq(projects.organizationId, input.organizationId),
        eq(reportTemplates.organizationId, input.organizationId),
        templateProjectScope(input.projectId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function createRun(values: InferInsertModel<typeof reportRuns>) {
  const [row] = await db.insert(reportRuns).values(values).returning();
  if (!row) throw new Error("Failed to create report run");
  return row;
}

async function claimQueuedRun(
  runId: string,
  projectId: string,
): Promise<ReportRun | null> {
  const [row] = await db
    .update(reportRuns)
    .set({ status: "rendering", errorMessage: null, completedAt: null })
    .where(
      and(
        eq(reportRuns.id, runId),
        eq(reportRuns.projectId, projectId),
        eq(reportRuns.status, "queued"),
      ),
    )
    .returning();
  return row ?? null;
}

async function transitionRun(input: {
  runId: string;
  projectId: string;
  from: ReportRunStatus[];
  values: Partial<InferInsertModel<typeof reportRuns>>;
}): Promise<ReportRun | null> {
  const [row] = await db
    .update(reportRuns)
    .set(input.values)
    .where(
      and(
        eq(reportRuns.id, input.runId),
        eq(reportRuns.projectId, input.projectId),
        inArray(reportRuns.status, input.from),
      ),
    )
    .returning();
  return row ?? null;
}

async function resetFailedRun(
  runId: string,
  projectId: string,
): Promise<ReportRun | null> {
  const [row] = await db
    .update(reportRuns)
    .set({ status: "queued", errorMessage: null, completedAt: null })
    .where(
      and(
        eq(reportRuns.id, runId),
        eq(reportRuns.projectId, projectId),
        eq(reportRuns.status, "failed"),
      ),
    )
    .returning();
  return row ?? null;
}

async function ensureDeliveries(
  rows: Array<InferInsertModel<typeof reportDeliveries>>,
) {
  if (rows.length === 0) return;
  await runBatch((tx) =>
    rows.map((row) =>
      tx.insert(reportDeliveries).values(row).onConflictDoNothing(),
    ),
  );
}

async function listDeliveries(runId: string) {
  return db
    .select()
    .from(reportDeliveries)
    .where(eq(reportDeliveries.runId, runId))
    .orderBy(asc(reportDeliveries.email));
}

async function incrementDeliveryAttempt(
  deliveryId: string,
): Promise<ReportDelivery | null> {
  const [row] = await db
    .update(reportDeliveries)
    .set({
      attempts: sql`${reportDeliveries.attempts} + 1`,
      errorMessage: null,
    })
    .where(
      and(
        eq(reportDeliveries.id, deliveryId),
        inArray(reportDeliveries.status, ["pending", "failed"]),
      ),
    )
    .returning();
  return row ?? null;
}

async function markDeliverySent(input: {
  deliveryId: string;
  providerMessageId: string;
  sentAt: string;
}) {
  await db
    .update(reportDeliveries)
    .set({
      status: "sent",
      providerMessageId: input.providerMessageId,
      errorMessage: null,
      sentAt: input.sentAt,
    })
    .where(
      and(
        eq(reportDeliveries.id, input.deliveryId),
        inArray(reportDeliveries.status, ["pending", "failed"]),
      ),
    );
}

async function markDeliveryFailed(deliveryId: string, errorMessage: string) {
  await db
    .update(reportDeliveries)
    .set({ status: "failed", errorMessage })
    .where(
      and(
        eq(reportDeliveries.id, deliveryId),
        inArray(reportDeliveries.status, ["pending", "failed"]),
      ),
    );
}

async function upsertArtifact(
  values: InferInsertModel<typeof reportArtifacts>,
) {
  await db
    .insert(reportArtifacts)
    .values(values)
    .onConflictDoUpdate({
      target: [reportArtifacts.runId, reportArtifacts.kind],
      set: {
        storageKey: values.storageKey,
        mimeType: values.mimeType,
        sizeBytes: values.sizeBytes,
        checksumSha256: values.checksumSha256,
      },
    });
}

async function listArtifacts(runId: string) {
  return db
    .select()
    .from(reportArtifacts)
    .where(eq(reportArtifacts.runId, runId))
    .orderBy(asc(reportArtifacts.kind));
}

async function createShareLink(
  values: InferInsertModel<typeof reportShareLinks>,
) {
  await db.insert(reportShareLinks).values(values);
}

async function getShareLinkByHash(tokenHash: string) {
  const [row] = await db
    .select({ link: reportShareLinks, run: reportRuns })
    .from(reportShareLinks)
    .innerJoin(reportRuns, eq(reportShareLinks.runId, reportRuns.id))
    .where(eq(reportShareLinks.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

async function markShareLinkAccessed(linkId: string, at: string) {
  await db
    .update(reportShareLinks)
    .set({ lastAccessedAt: at })
    .where(eq(reportShareLinks.id, linkId));
}

export const ReportRepository = {
  listTemplates,
  getTemplateScoped,
  getTemplateSections,
  createTemplate,
  listSchedules,
  getScheduleScoped,
  createSchedule,
  listRecipients,
  listRuns,
  getRunScoped,
  createRun,
  claimQueuedRun,
  transitionRun,
  resetFailedRun,
  ensureDeliveries,
  listDeliveries,
  incrementDeliveryAttempt,
  markDeliverySent,
  markDeliveryFailed,
  upsertArtifact,
  listArtifacts,
  createShareLink,
  getShareLinkByHash,
  markShareLinkAccessed,
} as const;
