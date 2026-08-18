import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BacklinkGapPage } from "@/client/features/gap/BacklinkGapPage";
import { backlinkGapSearchSchema } from "@/types/schemas/gap";

export const Route = createFileRoute("/_project/p/$projectId/backlink-gap")({
  validateSearch: backlinkGapSearchSchema,
  component: BacklinkGapRoute,
});

function BacklinkGapRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();

  return (
    <BacklinkGapPage
      projectId={projectId}
      search={search}
      navigate={navigate}
    />
  );
}
