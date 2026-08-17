import type { InferInsertModel } from "drizzle-orm";
import type { projectChangeEvents } from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import type { ChangeEventSource } from "@/types/schemas/change-events";
import { ChangeEventRepository } from "../repositories/ChangeEventRepository";

type ChangeEventInput = Omit<
  InferInsertModel<typeof projectChangeEvents>,
  "id" | "detectedAt"
> & { id?: string; detectedAt?: string };

const MAX_SUMMARY_LENGTH = 1_000;

async function record(input: ChangeEventInput) {
  const id = input.id ?? crypto.randomUUID();
  await ChangeEventRepository.insert({
    ...input,
    id,
    title: input.title.slice(0, 200),
    summary: input.summary.slice(0, MAX_SUMMARY_LENGTH),
    detectedAt: input.detectedAt ?? new Date().toISOString(),
  });
  return { id };
}

/** Detectors run inside workflows whose primary result must not depend on the
 * alert write. A failure here is logged and swallowed. */
async function recordSafely(input: ChangeEventInput) {
  try {
    await record(input);
  } catch (error) {
    console.error(
      `Change event ${input.source}/${input.eventType} was not recorded`,
      error,
    );
  }
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

async function markRead(input: {
  eventId: string;
  projectId: string;
  userId: string;
}) {
  const updated = await ChangeEventRepository.setState({
    ...input,
    now: new Date().toISOString(),
    dismiss: false,
  });
  if (!updated) throw new AppError("NOT_FOUND", "Change event not found.");
  return { eventId: input.eventId };
}

async function dismiss(input: {
  eventId: string;
  projectId: string;
  userId: string;
}) {
  const updated = await ChangeEventRepository.setState({
    ...input,
    now: new Date().toISOString(),
    dismiss: true,
  });
  if (!updated) throw new AppError("NOT_FOUND", "Change event not found.");
  return { eventId: input.eventId };
}

export const ChangeEventService = {
  record,
  recordSafely,
  getFeed,
  markRead,
  dismiss,
};
