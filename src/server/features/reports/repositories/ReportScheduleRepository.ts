import { and, asc, eq, isNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { projects, reportSchedules, reportTemplates } from "@/db/schema";

type ReportSchedule = typeof reportSchedules.$inferSelect;
const DUE_REPORTS_PER_TICK = 2;

async function listDueSchedules(nowIso: string) {
  return db
    .select({
      schedule: reportSchedules,
      organizationId: projects.organizationId,
    })
    .from(reportSchedules)
    .innerJoin(projects, eq(reportSchedules.projectId, projects.id))
    .innerJoin(
      reportTemplates,
      eq(reportSchedules.templateId, reportTemplates.id),
    )
    .where(
      and(
        eq(reportSchedules.isActive, true),
        ne(reportSchedules.frequency, "manual"),
        lte(reportSchedules.nextRunAt, nowIso),
        eq(reportTemplates.organizationId, projects.organizationId),
        isNull(reportTemplates.deletedAt),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(reportSchedules.nextRunAt), asc(reportSchedules.id))
    .limit(DUE_REPORTS_PER_TICK);
}

async function claimSchedule(input: {
  scheduleId: string;
  observedNextRunAt: string;
  nextRunAt: string | null;
  lastRunAt: string;
}): Promise<ReportSchedule | null> {
  const [row] = await db
    .update(reportSchedules)
    .set({ nextRunAt: input.nextRunAt, lastRunAt: input.lastRunAt })
    .where(
      and(
        eq(reportSchedules.id, input.scheduleId),
        eq(reportSchedules.isActive, true),
        eq(reportSchedules.nextRunAt, input.observedNextRunAt),
      ),
    )
    .returning();
  return row ?? null;
}

export const ReportScheduleRepository = {
  listDueSchedules,
  claimSchedule,
} as const;
