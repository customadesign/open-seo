import { createServerFn } from "@tanstack/react-start";
import type { z } from "zod";
import { requireProjectUse } from "@/serverFunctions/middleware";
import {
  domainOverviewSchema,
  domainKeywordSuggestionsSchema,
  domainKeywordsPageRequestSchema,
  domainPagesPageRequestSchema,
  domainReportRequestSchema,
  domainCompareRequestSchema,
  domainBrandTokenRequestSchema,
} from "@/types/schemas/domain";
import { DomainService } from "@/server/features/domain/services/DomainService";
import { resolveLabsMarket } from "@/shared/keyword-locations";

function shouldUseDomainE2eFixtures() {
  return import.meta.env.VITE_E2E_DOMAIN_FIXTURES === "1";
}

async function getDomainE2eFixtures() {
  return import("../../e2e/fixtures/domain-overview-fixtures");
}

export const getDomainOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainOverviewSchema)
  .handler(async ({ data, context }) => {
    const input = {
      ...data,
      ...resolveLabsMarket(data, context.project),
      projectId: context.projectId,
    };
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureOverview(input.domain);
    }

    return DomainService.getOverview(input, context);
  });

export const getDomainKeywordSuggestions = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainKeywordSuggestionsSchema)
  .handler(async ({ data, context }) =>
    DomainService.getSuggestedKeywords(
      {
        ...data,
        ...resolveLabsMarket(data, context.project),
        organizationId: context.organizationId,
        projectId: context.projectId,
      },
      context,
    ),
  );

export const getDomainKeywordsPage = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainKeywordsPageRequestSchema)
  .handler(async ({ data, context }) => {
    const input = {
      ...data,
      ...resolveLabsMarket(data, context.project),
      projectId: context.projectId,
    };
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixtureKeywordsPage(input);
    }

    return DomainService.getKeywordsPage(input, context);
  });

export const getDomainPagesPage = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainPagesPageRequestSchema)
  .handler(async ({ data, context }) => {
    const input = {
      ...data,
      ...resolveLabsMarket(data, context.project),
      projectId: context.projectId,
    };
    if (shouldUseDomainE2eFixtures()) {
      const fixtures = await getDomainE2eFixtures();
      return fixtures.getFixturePagesPage(input);
    }

    return DomainService.getPagesPage(input, context);
  });

function reportInput(
  data: z.infer<typeof domainReportRequestSchema>,
  context: {
    projectId: string;
    project: Parameters<typeof resolveLabsMarket>[1];
  },
) {
  return {
    ...data,
    ...resolveLabsMarket(data, context.project),
    projectId: context.projectId,
  };
}

export const getDomainPositionChanges = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainReportRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.getPositionChanges(reportInput(data, context), context),
  );

export const getDomainKeywordsByIntent = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainReportRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.getKeywordsByIntent(reportInput(data, context), context),
  );

export const getDomainSerpFeatures = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainReportRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.getSerpFeatures(reportInput(data, context), context),
  );

export const getDomainTrafficBreakdown = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainReportRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.getTrafficBreakdown(reportInput(data, context), context),
  );

export const getDomainCompetitors = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainReportRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.getCompetitors(reportInput(data, context), context),
  );

export const getDomainSubdomains = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainReportRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.getSubdomains(reportInput(data, context), context),
  );

export const getDomainCompare = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainCompareRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.getCompareDomains(
      {
        ...reportInput(data, context),
        domains: data.domains,
      },
      context,
    ),
  );

export const getDomainHistoricalOverview = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainReportRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.getHistoricalOverview(reportInput(data, context), context),
  );

export const getDomainPagesExtras = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainReportRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.getPagesExtras(reportInput(data, context), context),
  );

export const getDomainBrandTokens = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainReportRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.getBrandTokens({
      projectId: context.projectId,
      domain: data.domain,
      includeSubdomains: data.includeSubdomains,
    }),
  );

export const addDomainBrandToken = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainBrandTokenRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.addBrandToken({
      projectId: context.projectId,
      domain: data.domain,
      includeSubdomains: data.includeSubdomains,
      token: data.token,
    }),
  );

export const removeDomainBrandToken = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(domainBrandTokenRequestSchema)
  .handler(async ({ data, context }) =>
    DomainService.removeBrandToken({
      projectId: context.projectId,
      domain: data.domain,
      includeSubdomains: data.includeSubdomains,
      token: data.token,
    }),
  );
