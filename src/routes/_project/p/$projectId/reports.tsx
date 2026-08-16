import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "@/client/features/reports/ReportsPage";

export const Route = createFileRoute("/_project/p/$projectId/reports")({
  component: ReportsRoute,
});

function ReportsRoute() {
  const { projectId } = Route.useParams();
  return <ReportsPage projectId={projectId} />;
}
