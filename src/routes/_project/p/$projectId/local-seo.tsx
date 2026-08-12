import { createFileRoute } from "@tanstack/react-router";
import { LocalSeoPage } from "@/client/features/local-seo/LocalSeoPage";

export const Route = createFileRoute("/_project/p/$projectId/local-seo")({
  component: LocalSeoRoute,
});

function LocalSeoRoute() {
  const { projectId } = Route.useParams();
  return <LocalSeoPage projectId={projectId} />;
}
