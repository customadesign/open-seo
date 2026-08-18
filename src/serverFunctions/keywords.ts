import { createServerFn } from "@tanstack/react-start";
import {
  deleteSavedKeywordTagSchema,
  researchKeywordsSchema,
  saveKeywordsSchema,
  getSavedKeywordsSchema,
  exportSavedKeywordsSchema,
  removeSavedKeywordsSchema,
  refreshSavedKeywordMetricsSchema,
  serpAnalysisSchema,
  updateSavedKeywordTagSchema,
  updateSavedKeywordTagsSchema,
  estimateKeywordMagicSchema,
  runKeywordMagicSchema,
  getKeywordMagicPageSchema,
  exportKeywordMagicSchema,
  listKeywordMagicHistorySchema,
  saveKeywordMagicSelectionSchema,
  refreshKeywordMagicMetricsSchema,
} from "@/types/schemas/keywords";
import { KeywordResearchService } from "@/server/features/keywords/services/KeywordResearchService";
import {
  requireProjectContext,
  requireProjectUse,
} from "@/serverFunctions/middleware";
import { resolveMarket } from "@/shared/keyword-locations";

function shouldUseKeywordE2eFixtures() {
  return import.meta.env.VITE_E2E_KEYWORD_FIXTURES === "1";
}

async function getKeywordE2eFixtures() {
  return import("../../e2e/fixtures/keyword-research-fixtures");
}

export const researchKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(researchKeywordsSchema)
  .handler(async ({ data, context }) => {
    const input = {
      ...data,
      ...resolveMarket(data, context.project),
      projectId: context.projectId,
    };
    if (shouldUseKeywordE2eFixtures()) {
      const fixtures = await getKeywordE2eFixtures();
      return fixtures.getKeywordResearchFixture(input);
    }

    return KeywordResearchService.research(input, context);
  });

export const saveKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(saveKeywordsSchema)
  .handler(async ({ data, context }) => {
    return KeywordResearchService.saveKeywords({
      ...data,
      ...resolveMarket(data, context.project),
      projectId: context.projectId,
    });
  });

export const getSavedKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getSavedKeywordsSchema)
  .handler(async ({ data, context }) => {
    return KeywordResearchService.getSavedKeywords({
      ...data,
      projectId: context.projectId,
    });
  });

export const exportSavedKeywords = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(exportSavedKeywordsSchema)
  .handler(async ({ data, context }) => {
    return KeywordResearchService.exportSavedKeywords({
      ...data,
      projectId: context.projectId,
    });
  });

export const updateSavedKeywordTags = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(updateSavedKeywordTagsSchema)
  .handler(async ({ data, context }) => {
    return KeywordResearchService.updateSavedKeywordTags({
      ...data,
      projectId: context.projectId,
    });
  });

export const updateSavedKeywordTag = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(updateSavedKeywordTagSchema)
  .handler(async ({ data, context }) => {
    return KeywordResearchService.updateSavedKeywordTag({
      ...data,
      projectId: context.projectId,
    });
  });

export const deleteSavedKeywordTag = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(deleteSavedKeywordTagSchema)
  .handler(async ({ data, context }) => {
    return KeywordResearchService.deleteSavedKeywordTag({
      ...data,
      projectId: context.projectId,
    });
  });

export const removeSavedKeywords = createServerFn({
  method: "POST",
})
  .middleware(requireProjectUse)
  .validator(removeSavedKeywordsSchema)
  .handler(async ({ data, context }) => {
    return KeywordResearchService.removeSavedKeywords(context.projectId, data);
  });

export const refreshSavedKeywordMetrics = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(refreshSavedKeywordMetricsSchema)
  .handler(async ({ data, context }) => {
    return KeywordResearchService.refreshSavedKeywordMetrics(
      { projectId: context.projectId, keywords: data.keywords },
      context,
    );
  });

export const getSerpAnalysis = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(serpAnalysisSchema)
  .handler(async ({ data, context }) =>
    KeywordResearchService.getSerpAnalysis(
      {
        ...data,
        ...resolveMarket(data, context.project),
        projectId: context.projectId,
      },
      context,
    ),
  );

function magicFiltersFromPageInput(data: {
  matchType?: "all" | "broad" | "phrase" | "exact" | "related" | "questions";
  clusterId?: string;
  includeTerms?: string[];
  excludeTerms?: string[];
  minVolume?: number | null;
  maxVolume?: number | null;
  minCpc?: number | null;
  maxCpc?: number | null;
  minDifficulty?: number | null;
  maxDifficulty?: number | null;
  minWordCount?: number | null;
  maxWordCount?: number | null;
  intents?: (
    | "informational"
    | "commercial"
    | "transactional"
    | "navigational"
    | "unknown"
  )[];
  serpFeatures?: string[];
}) {
  return {
    matchType: data.matchType,
    clusterId: data.clusterId,
    includeTerms: data.includeTerms,
    excludeTerms: data.excludeTerms,
    minVolume: data.minVolume,
    maxVolume: data.maxVolume,
    minCpc: data.minCpc,
    maxCpc: data.maxCpc,
    minDifficulty: data.minDifficulty,
    maxDifficulty: data.maxDifficulty,
    minWordCount: data.minWordCount,
    maxWordCount: data.maxWordCount,
    intents: data.intents,
    serpFeatures: data.serpFeatures,
  };
}

export const estimateKeywordMagic = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(estimateKeywordMagicSchema)
  .handler(async ({ data, context }) => {
    const input = {
      ...data,
      ...resolveMarket(data, context.project),
      projectId: context.projectId,
    };
    if (shouldUseKeywordE2eFixtures()) {
      return {
        cached: true,
        runId: "e2e-keyword-magic",
        requests: 0,
        costUsd: 0,
        costCredits: 0,
        provider: "labs" as const,
        maxKeywords: data.maxKeywords ?? 10_000,
      };
    }
    return KeywordResearchService.estimateKeywordMagic(input, context);
  });

export const runKeywordMagic = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(runKeywordMagicSchema)
  .handler(async ({ data, context }) => {
    const input = {
      ...data,
      ...resolveMarket(data, context.project),
      projectId: context.projectId,
    };
    if (shouldUseKeywordE2eFixtures()) {
      const fixtures = await getKeywordE2eFixtures();
      return fixtures.getKeywordMagicRunFixture(input);
    }
    return KeywordResearchService.runKeywordMagic(input, context);
  });

export const getKeywordMagicPage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(getKeywordMagicPageSchema)
  .handler(async ({ data, context }) => {
    if (shouldUseKeywordE2eFixtures()) {
      const fixtures = await getKeywordE2eFixtures();
      return fixtures.getKeywordMagicPageFixture({
        ...data,
        projectId: context.projectId,
      });
    }
    return KeywordResearchService.getKeywordMagicPage({
      projectId: context.projectId,
      runId: data.runId,
      filters: magicFiltersFromPageInput(data),
      page: data.page,
      pageSize: data.pageSize,
      sort: data.sort,
      order: data.order,
    });
  });

export const exportKeywordMagic = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(exportKeywordMagicSchema)
  .handler(async ({ data, context }) => {
    if (shouldUseKeywordE2eFixtures()) {
      const fixtures = await getKeywordE2eFixtures();
      const page = fixtures.getKeywordMagicPageFixture({
        ...data,
        projectId: context.projectId,
        page: 1,
        pageSize: 500,
      });
      return { rows: page.rows };
    }
    return KeywordResearchService.exportKeywordMagic({
      projectId: context.projectId,
      runId: data.runId,
      filters: magicFiltersFromPageInput(data),
      sort: data.sort,
      order: data.order,
    });
  });

export const listKeywordMagicHistory = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(listKeywordMagicHistorySchema)
  .handler(async ({ context }) => {
    if (shouldUseKeywordE2eFixtures()) {
      return { runs: [] };
    }
    return KeywordResearchService.listKeywordMagicHistory({
      projectId: context.projectId,
    });
  });

export const saveKeywordMagicSelection = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(saveKeywordMagicSelectionSchema)
  .handler(async ({ data, context }) => {
    return KeywordResearchService.saveKeywordMagicSelection({
      ...data,
      ...resolveMarket(data, context.project),
      projectId: context.projectId,
    });
  });

export const refreshKeywordMagicMetrics = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(refreshKeywordMagicMetricsSchema)
  .handler(async ({ data, context }) => {
    return KeywordResearchService.refreshKeywordMagicMetrics(
      {
        ...data,
        ...resolveMarket(data, context.project),
        projectId: context.projectId,
      },
      context,
    );
  });
