import { z } from "zod";
import { CHANGE_EVENT_SOURCES } from "@/shared/change-events";

const idField = z.string().min(1).max(160);

export const changeEventSourceSchema = z.enum(CHANGE_EVENT_SOURCES);

export const listChangeEventsSchema = z.object({
  projectId: idField,
  source: changeEventSourceSchema.optional(),
  unreadOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
});

export const changeEventActionSchema = z.object({
  projectId: idField,
  eventId: idField,
});

export type ChangeEventSource = z.infer<typeof changeEventSourceSchema>;
