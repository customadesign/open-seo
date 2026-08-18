import { waitUntil } from "cloudflare:workers";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { CreditFeature } from "@/shared/billing-credit-features";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { normalizeDomainInput } from "@/server/lib/domainUtils";
import { mapKeywordItem } from "@/server/features/domain/services/domainKeywordMapper";
import { getKeywordsPage } from "@/server/features/domain/services/domainKeywordsPage";
import { getPagesPage } from "@/server/features/domain/services/domainPagesPage";
import { getPagesExtras } from "@/server/features/domain/services/domainPagesExtras";
import {
  getKeywordsByIntent,
  getPositionChanges,
  getSerpFeatures,
  getTrafficBreakdown,
} from "@/server/features/domain/services/domainResearchReports";
import {
  getCompareDomains,
  getCompetitors,
  getHistoricalOverview,
  getSubdomains,
} from "@/server/features/domain/services/domainProviderReports";
import {
  deriveBrandTokensFromDomain,
  normalizeBrandToken,
} from "@/server/features/domain/services/domainBrandTokens";
import { DomainResearchRepository } from "@/server/features/domain/repositories/DomainResearchRepository";
import { AppError } from "@/server/lib/errors";

// Lets a caller attribute spend to its own feature (e.g. onboarding). Applied
// to the DataForSEO call, not the cache key, so cached results are shared
// across callers.
type MeteringOverrides = {
  creditFeature?: CreditFeature;
};

/** Domain overview data is refreshed every 12 hours. */
const DOMAIN_OVERVIEW_TTL_SECONDS = 12 * 60 * 60;

const domainOverviewResultSchema = z.object({
  domain: z.string(),
  organicTraffic: z.number().nullable(),
  organicKeywords: z.number().nullable(),
  trafficCost: z.number().nullable(),
  backlinks: z.number().nullable(),
  referringDomains: z.number().nullable(),
  hasData: z.boolean(),
  fetchedAt: z.string(),
});

type DomainOverviewResult = z.infer<typeof domainOverviewResultSchema>;

async function getOverview(
  input: {
    projectId: string;
    domain: string;
    includeSubdomains: boolean;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: BillingCustomerContext,
  metering: MeteringOverrides = {},
): Promise<DomainOverviewResult> {
  const domain = normalizeDomainInput(input.domain, input.includeSubdomains);

  const cacheKey = await buildCacheKey("domain:overview", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    includeSubdomains: input.includeSubdomains,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });

  const cachedRaw = await getCached(cacheKey);
  const cached = domainOverviewResultSchema.safeParse(cachedRaw);
  if (cached.success && cached.data.hasData) {
    return cached.data;
  }

  const nowIso = new Date().toISOString();
  const dataforseo = createDataforseoClient(billingCustomer);

  const metricsResponse = await dataforseo.domain.rankOverview({
    target: domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    ...metering,
  });

  const metrics = metricsResponse[0];

  const organicTraffic =
    metrics?.metrics?.organic?.etv != null
      ? Math.round(metrics.metrics.organic.etv)
      : null;
  const organicKeywords =
    metrics?.metrics?.organic?.count != null
      ? Math.round(metrics.metrics.organic.count)
      : null;
  const trafficCost =
    metrics?.metrics?.organic?.estimated_paid_traffic_cost != null
      ? Math.round(metrics.metrics.organic.estimated_paid_traffic_cost * 100) /
        100
      : null;

  const result: DomainOverviewResult = {
    domain,
    organicTraffic,
    organicKeywords,
    trafficCost,
    backlinks: null,
    referringDomains: null,
    hasData: organicKeywords != null && organicKeywords > 0,
    fetchedAt: nowIso,
  };

  if (result.hasData) {
    // waitUntil, not void: workerd cancels unregistered pending I/O once the
    // response is sent, so a fire-and-forget put never persists the cache.
    waitUntil(
      setCached(cacheKey, result, DOMAIN_OVERVIEW_TTL_SECONDS).catch(
        (error) => {
          console.error("domain.overview.cache-write failed:", error);
        },
      ),
    );
  }

  return result;
}

async function getSuggestedKeywords(
  input: {
    domain: string;
    locationCode: number;
    languageCode: string;
    organizationId: string;
    projectId: string;
  },
  billingCustomer: BillingCustomerContext,
  metering: MeteringOverrides = {},
): Promise<
  Array<{
    keyword: string;
    position: number | null;
    searchVolume: number | null;
    traffic: number | null;
    cpc: number | null;
    keywordDifficulty: number | null;
  }>
> {
  const domain = normalizeDomainInput(input.domain, true);

  const cacheKey = await buildCacheKey("domain:keyword-suggestions", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });

  const cachedRaw = await getCached(cacheKey);
  const cached = z
    .array(
      z.object({
        keyword: z.string(),
        position: z.number().nullable(),
        searchVolume: z.number().nullable(),
        traffic: z.number().nullable(),
        cpc: z.number().nullable(),
        keywordDifficulty: z.number().nullable(),
      }),
    )
    .safeParse(cachedRaw);
  if (cached.success && cached.data.length > 0) {
    return cached.data;
  }

  const dataforseo = createDataforseoClient(billingCustomer);

  const rankedKeywordsResponse = await dataforseo.domain.rankedKeywords({
    target: domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: 100,
    orderBy: ["ranked_serp_element.serp_item.etv,desc"],
    ...metering,
  });

  const keywords = rankedKeywordsResponse.items
    .map((item) => mapKeywordItem(item))
    .filter(
      (item): item is NonNullable<ReturnType<typeof mapKeywordItem>> =>
        item != null,
    )
    .map((item) => ({
      keyword: item.keyword,
      position: item.position,
      searchVolume: item.searchVolume,
      traffic: item.traffic,
      cpc: item.cpc,
      keywordDifficulty: item.keywordDifficulty,
    }));

  if (keywords.length > 0) {
    waitUntil(
      setCached(cacheKey, keywords, DOMAIN_OVERVIEW_TTL_SECONDS).catch(
        (error) => {
          console.error(
            "domain.keyword-suggestions.cache-write failed:",
            error,
          );
        },
      ),
    );
  }

  return keywords;
}

async function listResolvedBrandTokens(input: {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
}) {
  const domain = normalizeDomainInput(input.domain, input.includeSubdomains);
  const derived = deriveBrandTokensFromDomain(domain);
  const stored = await DomainResearchRepository.listBrandTokens(
    input.projectId,
    domain,
  );
  const user = stored.map((row) => row.token);
  const all = [...new Set([...derived, ...user])].toSorted();
  return { domain, derived, user, all };
}

async function getBrandTokens(input: {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
}) {
  return listResolvedBrandTokens(input);
}

async function addBrandToken(input: {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
  token: string;
}) {
  const tokens = await listResolvedBrandTokens(input);
  const token = normalizeBrandToken(input.token);
  if (!token) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Enter a brand token of 2–64 letters or numbers.",
    );
  }
  if (tokens.derived.includes(token)) {
    return tokens;
  }
  await DomainResearchRepository.addBrandToken({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    domain: tokens.domain,
    token,
  });
  return listResolvedBrandTokens({
    projectId: input.projectId,
    domain: tokens.domain,
    includeSubdomains: true,
  });
}

async function removeBrandToken(input: {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
  token: string;
}) {
  const tokens = await listResolvedBrandTokens(input);
  const token = normalizeBrandToken(input.token);
  if (!token) {
    throw new AppError("VALIDATION_ERROR", "Brand token is invalid.");
  }
  if (tokens.derived.includes(token)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Derived domain tokens cannot be removed. Add a more specific user token instead.",
    );
  }
  await DomainResearchRepository.removeBrandToken({
    projectId: input.projectId,
    domain: tokens.domain,
    token,
  });
  return listResolvedBrandTokens({
    projectId: input.projectId,
    domain: tokens.domain,
    includeSubdomains: true,
  });
}

export const DomainService = {
  getOverview,
  getSuggestedKeywords,
  getKeywordsPage,
  getPagesPage,
  getPagesExtras,
  getPositionChanges,
  getKeywordsByIntent,
  getSerpFeatures,
  getTrafficBreakdown,
  getCompetitors,
  getSubdomains,
  getCompareDomains,
  getHistoricalOverview,
  getBrandTokens,
  addBrandToken,
  removeBrandToken,
} as const;
