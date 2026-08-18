import {
  and,
  count,
  desc,
  eq,
  gte,
  isNull,
  lte,
  type InferInsertModel,
} from "drizzle-orm";
import { db } from "@/db";
import { projectChangeEvents, projectChangeEventStates } from "@/db/schema";
import type { ChangeEventSource } from "@/types/schemas/change-events";

export const CHANGE_EVENT_REPORT_LIMIT = 50;

type NewChangeEvent = InferInsertModel<typeof projectChangeEvents>;

async function insert(values: NewChangeEvent) {
  await db
    .insert(projectChangeEvents)
    .values(values)
    .onConflictDoNothing({
      target: [
        projectChangeEvents.projectId,
        projectChangeEvents.source,
        projectChangeEvents.dedupeKey,
      ],
    });
}

async function listForProject(input: {
  projectId: string;
  userId: string;
  source?: ChangeEventSource;
  unreadOnly: boolean;
  limit: number;
}) {
  return db
    .select({
      event: projectChangeEvents,
      readAt: projectChangeEventStates.readAt,
      dismissedAt: projectChangeEventStates.dismissedAt,
    })
    .from(projectChangeEvents)
    .leftJoin(
      projectChangeEventStates,
      and(
        eq(projectChangeEventStates.eventId, projectChangeEvents.id),
        eq(projectChangeEventStates.userId, input.userId),
      ),
    )
    .where(
      and(
        eq(projectChangeEvents.projectId, input.projectId),
        input.source ? eq(projectChangeEvents.source, input.source) : undefined,
        isNull(projectChangeEventStates.dismissedAt),
        input.unreadOnly ? isNull(projectChangeEventStates.readAt) : undefined,
      ),
    )
    .orderBy(
      desc(projectChangeEvents.occurredAt),
      desc(projectChangeEvents.detectedAt),
      desc(projectChangeEvents.id),
    )
    .limit(input.limit);
}

async function countUnread(projectId: string, userId: string) {
  const [row] = await db
    .select({ total: count() })
    .from(projectChangeEvents)
    .leftJoin(
      projectChangeEventStates,
      and(
        eq(projectChangeEventStates.eventId, projectChangeEvents.id),
        eq(projectChangeEventStates.userId, userId),
      ),
    )
    .where(
      and(
        eq(projectChangeEvents.projectId, projectId),
        isNull(projectChangeEventStates.readAt),
        isNull(projectChangeEventStates.dismissedAt),
      ),
    );
  return row?.total ?? 0;
}

function reportPeriodWhere(input: {
  projectId: string;
  periodStart: string;
  periodEnd: string;
}) {
  return and(
    eq(projectChangeEvents.projectId, input.projectId),
    gte(projectChangeEvents.occurredAt, input.periodStart),
    lte(projectChangeEvents.occurredAt, input.periodEnd),
  );
}

function clampedReportLimit(limit: number) {
  return Math.min(Math.max(Math.trunc(limit), 1), CHANGE_EVENT_REPORT_LIMIT);
}

/** Immutable project events for a report period. Never joins per-user state. */
async function listForReportPeriod(input: {
  projectId: string;
  periodStart: string;
  periodEnd: string;
  limit: number;
}) {
  return db
    .select()
    .from(projectChangeEvents)
    .where(reportPeriodWhere(input))
    .orderBy(
      desc(projectChangeEvents.occurredAt),
      desc(projectChangeEvents.detectedAt),
      desc(projectChangeEvents.id),
    )
    .limit(clampedReportLimit(input.limit));
}

async function summarizeForReportPeriod(input: {
  projectId: string;
  periodStart: string;
  periodEnd: string;
}) {
  return db
    .select({
      source: projectChangeEvents.source,
      severity: projectChangeEvents.severity,
      total: count(),
    })
    .from(projectChangeEvents)
    .where(reportPeriodWhere(input))
    .groupBy(projectChangeEvents.source, projectChangeEvents.severity);
}

async function eventExistsInProject(eventId: string, projectId: string) {
  const [row] = await db
    .select({ id: projectChangeEvents.id })
    .from(projectChangeEvents)
    .where(
      and(
        eq(projectChangeEvents.id, eventId),
        eq(projectChangeEvents.projectId, projectId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

async function markRead(input: {
  eventId: string;
  projectId: string;
  userId: string;
  now: string;
}) {
  if (!(await eventExistsInProject(input.eventId, input.projectId))) {
    return false;
  }
  await db
    .insert(projectChangeEventStates)
    .values({
      id: crypto.randomUUID(),
      eventId: input.eventId,
      userId: input.userId,
      readAt: input.now,
      dismissedAt: null,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        projectChangeEventStates.eventId,
        projectChangeEventStates.userId,
      ],
      set: { readAt: input.now, dismissedAt: null, updatedAt: input.now },
    });
  return true;
}

async function dismiss(input: {
  eventId: string;
  projectId: string;
  userId: string;
  now: string;
}) {
  if (!(await eventExistsInProject(input.eventId, input.projectId))) {
    return false;
  }
  await db
    .insert(projectChangeEventStates)
    .values({
      id: crypto.randomUUID(),
      eventId: input.eventId,
      userId: input.userId,
      readAt: input.now,
      dismissedAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        projectChangeEventStates.eventId,
        projectChangeEventStates.userId,
      ],
      set: {
        readAt: input.now,
        dismissedAt: input.now,
        updatedAt: input.now,
      },
    });
  return true;
}

export const ChangeEventRepository = {
  insert,
  listForProject,
  listForReportPeriod,
  summarizeForReportPeriod,
  countUnread,
  markRead,
  dismiss,
} as const;
