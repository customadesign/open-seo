import { createFileRoute, redirect } from "@tanstack/react-router";
import { KeywordResearchPage } from "@/client/features/keywords/page/KeywordResearchPage";
import {
  isResultLimit,
  normalizeKeywordMode,
  normalizeLegacyKeywordSearch,
  normalizeMatchType,
  normalizeSortDir,
  normalizeSortField,
} from "@/client/features/keywords/keywordSearchParams";
import {
  KEYWORD_MAGIC_DEFAULT_KEYWORDS,
  clampKeywordMagicScale,
} from "@/shared/keyword-magic";
import { keywordsSearchSchema } from "@/types/schemas/keywords";

export const Route = createFileRoute("/_project/p/$projectId/keywords")({
  validateSearch: keywordsSearchSchema,
  beforeLoad: ({ params, search }) => {
    const { normalized, changed } = normalizeLegacyKeywordSearch(search);
    if (!changed) return;

    throw redirect({
      to: "/p/$projectId/keywords",
      params: { projectId: params.projectId },
      search: normalized,
      replace: true,
    });
  },
  component: KeywordResearchPageRoute,
});

function KeywordResearchPageRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const {
    q: keywordInput = "",
    loc: locationCode,
    kLimit: resultLimit = 150,
    mode: keywordMode = "auto",
    sort: sortField = "searchVolume",
    order: sortDir = "desc",
    match: matchType,
    cluster: clusterId,
    page,
    size: pageSize,
    scale,
    run: runId,
  } = search;
  return (
    <KeywordResearchPage
      projectId={projectId}
      keywordInput={keywordInput}
      locationCode={locationCode}
      resultLimit={isResultLimit(resultLimit) ? resultLimit : 150}
      keywordMode={normalizeKeywordMode(keywordMode)}
      clickstream={search.cs ?? false}
      sortField={normalizeSortField(sortField)}
      sortDir={normalizeSortDir(sortDir)}
      matchType={normalizeMatchType(matchType)}
      clusterId={clusterId}
      page={page}
      pageSize={pageSize}
      scale={
        scale ? clampKeywordMagicScale(scale) : KEYWORD_MAGIC_DEFAULT_KEYWORDS
      }
      runId={runId}
      minWordCount={search.minWords}
      maxWordCount={search.maxWords}
      serpFeatures={search.serp}
    />
  );
}
