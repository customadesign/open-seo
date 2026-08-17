import { createFileRoute } from "@tanstack/react-router";
import { AiVisibilityPage } from "@/client/features/ai-visibility/AiVisibilityPage";

export const Route = createFileRoute("/_project/p/$projectId/ai-visibility")({
  component: AiVisibilityRoute,
});

function AiVisibilityRoute() {
  const { projectId } = Route.useParams();
  return <AiVisibilityPage projectId={projectId} />;
}
