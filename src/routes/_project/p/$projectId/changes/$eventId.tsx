import { createFileRoute } from "@tanstack/react-router";
import { ChangeEventDetail } from "@/client/features/change-events/ChangeEventDetail";

export const Route = createFileRoute("/_project/p/$projectId/changes/$eventId")(
  {
    component: ChangeEventDetailRoute,
  },
);

function ChangeEventDetailRoute() {
  const { projectId, eventId } = Route.useParams();
  return <ChangeEventDetail projectId={projectId} eventId={eventId} />;
}
