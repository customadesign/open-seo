import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OnPagePage } from "@/client/features/on-page/OnPagePage";

const searchSchema = z.object({
  page: z.string().optional(),
});

export const Route = createFileRoute("/_project/p/$projectId/on-page")({
  validateSearch: searchSchema,
  component: OnPageRoute,
});

function OnPageRoute() {
  const { projectId } = Route.useParams();
  const { page } = Route.useSearch();
  return <OnPagePage projectId={projectId} pageId={page} />;
}
