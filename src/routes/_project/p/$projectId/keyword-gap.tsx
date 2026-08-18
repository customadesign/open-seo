import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { KeywordGapPage } from "@/client/features/gap/KeywordGapPage";
import { keywordGapSearchSchema } from "@/types/schemas/gap";

const DEFAULT_SEARCH = {
  base: "",
  competitors: "",
  subdomains: true,
  loc: undefined,
  classification: undefined,
  minVol: undefined,
  maxVol: undefined,
  minKd: undefined,
  maxKd: undefined,
  intent: undefined,
  include: "",
  exclude: "",
} as const;

export const Route = createFileRoute("/_project/p/$projectId/keyword-gap")({
  validateSearch: keywordGapSearchSchema,
  search: {
    middlewares: [stripSearchParams(DEFAULT_SEARCH)],
  },
  component: KeywordGapRoute,
});

function KeywordGapRoute() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();

  return (
    <KeywordGapPage projectId={projectId} search={search} navigate={navigate} />
  );
}
