import type { InferInsertModel } from "drizzle-orm";
import type { projectChangeEvents } from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import type { ChangeEventSource } from "@/types/schemas/change-events";
import { ChangeEventRepository } from "../repositories/ChangeEventRepository";

type ChangeEventInput = Omit<
  InferInsertModel<typeof projectChangeEvents>,
  "id" | "detectedAt"
> & { id?: string; detectedAt?: string };

async function record(input: ChangeEventInput) {
  const id = input.id ?? crypto.randomUUID();
  await ChangeEventRepository.insert({
    ...input,
    id,
    detectedAt: input.detectedAt ?? new Date().toISOString(),
  });
  return { id };
}

async function getFeed(input: {
  projectId: string;
  userId: string;
  source?: ChangeEventSource;
  unreadOnly: boolean;
  limit: number;
}) {
  const [rows, unreadCount] = await Promise.all([
    ChangeEventRepository.listForProject(input),
    ChangeEventRepository.countUnread(input.projectId, input.userId),
  ]);
  return {
    unreadCount,
    events: rows.map(({ event, readAt }) => ({
      ...event,
      isRead: readAt !== null,
    })),
  };
}

/** Returns null rather than throwing NOT_FOUND: for the detail page a missing
 * event is an absence to render, not a failure. The mutations below still throw,
 * because there "nothing happened" has to reach the caller as an error. */
async function getEvent(input: {
  eventId: string;
  projectId: string;
  userId: string;
}) {
  const row = await ChangeEventRepository.findForUser(input);
  if (!row) return null;
  return {
    ...row.event,
    isRead: row.readAt !== null,
    isDismissed: row.dismissedAt !== null,
  };
}

async function markRead(input: {
  eventId: string;
  projectId: string;
  userId: string;
}) {
  const updated = await ChangeEventRepository.markRead({
    ...input,
    now: new Date().toISOString(),
  });
  if (!updated) throw new AppError("NOT_FOUND");
  return { eventId: input.eventId };
}

async function dismiss(input: {
  eventId: string;
  projectId: string;
  userId: string;
}) {
  const updated = await ChangeEventRepository.dismiss({
    ...input,
    now: new Date().toISOString(),
  });
  if (!updated) throw new AppError("NOT_FOUND");
  return { eventId: input.eventId };
}

export const ChangeEventService = {
  record,
  getFeed,
  getEvent,
  markRead,
  dismiss,
} as const;
