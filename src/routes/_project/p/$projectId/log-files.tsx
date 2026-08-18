import { createFileRoute } from "@tanstack/react-router";
import { LogFilesPage } from "@/client/features/log-files/LogFilesPage";

export const Route = createFileRoute("/_project/p/$projectId/log-files")({
  component: LogFilesRoute,
});

function LogFilesRoute() {
  const { projectId } = Route.useParams();
  return <LogFilesPage projectId={projectId} />;
}
