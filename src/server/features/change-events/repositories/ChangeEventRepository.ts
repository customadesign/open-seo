import {
  and,
  count,
  desc,
  eq,
  isNull,
  type InferInsertModel,
} from "drizzle-orm";
import { db } from "@/db";
import { projectChangeEvents, projectChangeEventStates } from "@/db/schema";
import type { ChangeEventSource } from "@/types/schemas/change-events";

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

/** One event with the caller's own read/dismiss state. Unlike the feed this does
 * not filter out dismissed events: dismissing hides a row from the list, it does
 * not delete it, so a bookmark or a link out of a report digest must still open. */
async function findForUser(input: {
  eventId: string;
  projectId: string;
  userId: string;
}) {
  const [row] = await db
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
        eq(projectChangeEvents.id, input.eventId),
        eq(projectChangeEvents.projectId, input.projectId),
      ),
    )
    .limit(1);
  return row ?? null;
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

async function setState(input: {
  eventId: string;
  projectId: string;
  userId: string;
  now: string;
  dismiss: boolean;
}) {
  // Scoping the write to the caller's project keeps a guessed event id from
  // creating state rows against another workspace's events.
  if (!(await eventExistsInProject(input.eventId, input.projectId))) {
    return false;
  }
  const dismissedAt = input.dismiss ? input.now : null;
  await db
    .insert(projectChangeEventStates)
    .values({
      id: crypto.randomUUID(),
      eventId: input.eventId,
      userId: input.userId,
      readAt: input.now,
      dismissedAt,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        projectChangeEventStates.eventId,
        projectChangeEventStates.userId,
      ],
      // Marking read never clears an existing dismissal: dismissedAt is only
      // written on the dismiss path.
      set: {
        readAt: input.now,
        updatedAt: input.now,
        ...(input.dismiss ? { dismissedAt } : {}),
      },
    });
  return true;
}

export const ChangeEventRepository = {
  insert,
  listForProject,
  findForUser,
  countUnread,
  setState,
};
