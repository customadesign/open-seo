/**
 * Data access for audit_schedules: at most one recurring site-audit schedule
 * per project. Provider-aware (D1 or Postgres) via the `@/db` handle.
 */
import { and, asc, eq, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { auditSchedules, projects } from "@/db/schema";
import type {
  AuditScheduleInterval,
  AuditScheduleSkipReason,
} from "@/shared/audit-schedule";

/**
 * Upper bound on schedules examined per cron tick. Starts are capped much
 * lower (see the scheduler); unexamined schedules stay due because a slot is
 * only claimed immediately before its audit starts.
 */
const DUE_SCHEDULES_PER_TICK = 100;

type ScheduleWrite = {
  startUrl: string;
  maxPages: number;
  lighthouseStrategy: "auto" | "none";
  scheduleInterval: AuditScheduleInterval;
  isActive: boolean;
  nextRunAt: string | null;
};

async function getByProject(projectId: string) {
  return db.query.auditSchedules.findFirst({
    where: eq(auditSchedules.projectId, projectId),
  });
}

/**
 * Create or replace the project's schedule. The unique index on project_id is
 * the concurrency guard: two racing saves cannot leave two schedules behind.
 */
async function upsertForProject(
  input: ScheduleWrite & {
    projectId: string;
    createdByUserId: string;
  },
) {
  const now = new Date().toISOString();
  await db
    .insert(auditSchedules)
    .values({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      createdByUserId: input.createdByUserId,
      startUrl: input.startUrl,
      maxPages: input.maxPages,
      lighthouseStrategy: input.lighthouseStrategy,
      scheduleInterval: input.scheduleInterval,
      isActive: input.isActive,
      nextRunAt: input.nextRunAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: auditSchedules.projectId,
      set: {
        createdByUserId: input.createdByUserId,
        startUrl: input.startUrl,
        maxPages: input.maxPages,
        lighthouseStrategy: input.lighthouseStrategy,
        scheduleInterval: input.scheduleInterval,
        isActive: input.isActive,
        nextRunAt: input.nextRunAt,
        updatedAt: now,
      },
    });
  return getByProject(input.projectId);
}

/**
 * Schedules whose next run has come due, oldest anchor first. Manual cadences
 * and archived projects are excluded here rather than in the caller so a stale
 * next_run_at on a paused row can never be acted on.
 */
async function getDueSchedulesWithOrganization(nowIso: string) {
  return db
    .select({
      id: auditSchedules.id,
      projectId: auditSchedules.projectId,
      createdByUserId: auditSchedules.createdByUserId,
      startUrl: auditSchedules.startUrl,
      maxPages: auditSchedules.maxPages,
      lighthouseStrategy: auditSchedules.lighthouseStrategy,
      scheduleInterval: auditSchedules.scheduleInterval,
      nextRunAt: auditSchedules.nextRunAt,
      organizationId: projects.organizationId,
    })
    .from(auditSchedules)
    .innerJoin(projects, eq(auditSchedules.projectId, projects.id))
    .where(
      and(
        eq(auditSchedules.isActive, true),
        ne(auditSchedules.scheduleInterval, "manual"),
        lte(auditSchedules.nextRunAt, nowIso),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(auditSchedules.nextRunAt), asc(auditSchedules.id))
    .limit(DUE_SCHEDULES_PER_TICK);
}

/**
 * Conditionally advance a due schedule. `next_run_at` equality is the
 * compare-and-set token, so a concurrent tick (or a save that paused the
 * schedule) loses the claim instead of double-starting an audit.
 */
async function claimDueSchedule(input: {
  scheduleId: string;
  projectId: string;
  observedNextRunAt: string;
  nextRunAt: string;
  lastSkipReason?: AuditScheduleSkipReason | null;
}): Promise<boolean> {
  const claimed = await db
    .update(auditSchedules)
    .set({
      nextRunAt: input.nextRunAt,
      updatedAt: new Date().toISOString(),
      ...(input.lastSkipReason !== undefined && {
        lastSkipReason: input.lastSkipReason,
      }),
    })
    .where(
      and(
        eq(auditSchedules.id, input.scheduleId),
        eq(auditSchedules.projectId, input.projectId),
        eq(auditSchedules.isActive, true),
        eq(auditSchedules.nextRunAt, input.observedNextRunAt),
      ),
    )
    .returning({ id: auditSchedules.id });
  return claimed.length > 0;
}

/**
 * Record why a due tick started nothing, without touching the schedule anchor.
 * Used when the occurrence is deliberately kept (an audit is still running), so
 * the next tick retries it.
 */
async function recordSkip(input: {
  scheduleId: string;
  projectId: string;
  reason: AuditScheduleSkipReason;
}) {
  await db
    .update(auditSchedules)
    .set({
      lastSkipReason: input.reason,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(auditSchedules.id, input.scheduleId),
        eq(auditSchedules.projectId, input.projectId),
      ),
    );
}

/** Record a started run. Clearing the skip reason retires a stale badge. */
async function recordRunStarted(input: {
  scheduleId: string;
  projectId: string;
  auditId: string;
  lastRunAt: string;
}) {
  await db
    .update(auditSchedules)
    .set({
      lastRunAt: input.lastRunAt,
      lastRunAuditId: input.auditId,
      lastSkipReason: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(auditSchedules.id, input.scheduleId),
        eq(auditSchedules.projectId, input.projectId),
      ),
    );
}

export const AuditScheduleRepository = {
  getByProject,
  upsertForProject,
  getDueSchedulesWithOrganization,
  claimDueSchedule,
  recordSkip,
  recordRunStarted,
};
