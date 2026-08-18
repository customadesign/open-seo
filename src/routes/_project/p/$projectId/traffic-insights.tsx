import { createFileRoute } from "@tanstack/react-router";
import { TrafficInsightsPage } from "@/client/features/traffic-insights/TrafficInsightsPage";

export const Route = createFileRoute("/_project/p/$projectId/traffic-insights")(
  {
    component: TrafficInsightsRoute,
  },
);

function TrafficInsightsRoute() {
  const { projectId } = Route.useParams();
  return <TrafficInsightsPage projectId={projectId} />;
}
