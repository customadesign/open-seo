import { createServerFn } from "@tanstack/react-start";
import { ChangeEventService } from "@/server/features/change-events/services/ChangeEventService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  changeEventActionSchema,
  listChangeEventsSchema,
} from "@/types/schemas/change-events";

export const getChangeEventFeed = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listChangeEventsSchema)
  .handler(({ data, context }) =>
    ChangeEventService.getFeed({
      projectId: context.projectId,
      userId: context.userId,
      source: data.source,
      unreadOnly: data.unreadOnly,
      limit: data.limit,
    }),
  );

export const markChangeEventRead = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(changeEventActionSchema)
  .handler(({ data, context }) =>
    ChangeEventService.markRead({
      eventId: data.eventId,
      projectId: context.projectId,
      userId: context.userId,
    }),
  );

export const dismissChangeEvent = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(changeEventActionSchema)
  .handler(({ data, context }) =>
    ChangeEventService.dismiss({
      eventId: data.eventId,
      projectId: context.projectId,
      userId: context.userId,
    }),
  );
