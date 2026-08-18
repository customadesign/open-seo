import { z } from "zod";
import {
  CHANGE_EVENT_SEVERITIES,
  CHANGE_EVENT_SOURCES,
} from "@/shared/change-events";

const projectIdField = z.string().uuid();

export const changeEventSourceSchema = z.enum(CHANGE_EVENT_SOURCES);
export type ChangeEventSource = z.infer<typeof changeEventSourceSchema>;

export const changeEventSeveritySchema = z.enum(CHANGE_EVENT_SEVERITIES);
export type ChangeEventSeverity = z.infer<typeof changeEventSeveritySchema>;

export const listChangeEventsSchema = z.object({
  projectId: projectIdField,
  source: changeEventSourceSchema.optional(),
  unreadOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
});

export const changeEventActionSchema = z.object({
  projectId: projectIdField,
  eventId: z.string().uuid(),
});
