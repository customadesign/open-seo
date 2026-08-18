import { createFileRoute } from "@tanstack/react-router";
import { ChangeEventsPage } from "@/client/features/change-events/ChangeEventsPage";

export const Route = createFileRoute("/_project/p/$projectId/changes/")({
  component: ChangesRoute,
});

function ChangesRoute() {
  const { projectId } = Route.useParams();
  return <ChangeEventsPage projectId={projectId} />;
}
