import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { normalizeDomainInput } from "@/server/lib/domainUtils";

const REPORT_TTL_SECONDS = 12 * 60 * 60;

const competitorsResultSchema = z.object({
  domain: z.string(),
  competitors: z.array(
    z.object({
      domain: z.string(),
      commonKeywords: z.number().nullable(),
      competitionLevel: z.number().nullable(),
      avgPosition: z.number().nullable(),
      organicKeywords: z.number().nullable(),
      organicTraffic: z.number().nullable(),
    }),
  ),
  fetchedAt: z.string(),
});

const subdomainsResultSchema = z.object({
  domain: z.string(),
  subdomains: z.array(
    z.object({
      subdomain: z.string(),
      organicTraffic: z.number().nullable(),
      organicKeywords: z.number().nullable(),
    }),
  ),
  fetchedAt: z.string(),
});

const compareResultSchema = z.object({
  domains: z.array(
    z.object({
      domain: z.string(),
      organicTraffic: z.number().nullable(),
      organicKeywords: z.number().nullable(),
      trafficCost: z.number().nullable(),
    }),
  ),
  fetchedAt: z.string(),
});

const historyResultSchema = z.object({
  domain: z.string(),
  months: z.array(
    z.object({
      year: z.number(),
      month: z.number(),
      organicTraffic: z.number().nullable(),
      organicKeywords: z.number().nullable(),
      trafficCost: z.number().nullable(),
      newKeywords: z.number().nullable(),
      lostKeywords: z.number().nullable(),
      improvedKeywords: z.number().nullable(),
      declinedKeywords: z.number().nullable(),
    }),
  ),
  fetchedAt: z.string(),
});

type DomainReportInput = {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
  locationCode: number;
  languageCode: string;
};

function metricCount(value: number | null | undefined): number | null {
  return value != null ? Math.round(value) : null;
}

export async function getCompetitors(
  input: DomainReportInput,
  billingCustomer: BillingCustomerContext,
) {
  const domain = normalizeDomainInput(input.domain, input.includeSubdomains);
  const cacheKey = await buildCacheKey("domain:competitors", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    includeSubdomains: input.includeSubdomains,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
  const cached = competitorsResultSchema.safeParse(await getCached(cacheKey));
  if (cached.success) return cached.data;

  const dataforseo = createDataforseoClient(billingCustomer);
  const response = await dataforseo.domain.competitors({
    target: domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: 100,
    excludeTopDomains: true,
    itemTypes: ["organic"],
  });

  const result = {
    domain,
    competitors: response.items.flatMap((item) => {
      if (!item.domain) return [];
      const commonKeywords = metricCount(item.intersections);
      const targetKeywords = metricCount(item.metrics?.organic?.count);
      return [
        {
          domain: item.domain,
          commonKeywords,
          competitionLevel:
            commonKeywords != null &&
            targetKeywords != null &&
            targetKeywords > 0
              ? Math.round((commonKeywords / targetKeywords) * 1000) / 1000
              : null,
          avgPosition:
            item.avg_position != null
              ? Math.round(item.avg_position * 10) / 10
              : null,
          organicKeywords: metricCount(
            item.full_domain_metrics?.organic?.count,
          ),
          organicTraffic: metricCount(item.full_domain_metrics?.organic?.etv),
        },
      ];
    }),
    fetchedAt: new Date().toISOString(),
  };

  waitUntil(
    setCached(cacheKey, result, REPORT_TTL_SECONDS).catch((error) => {
      console.error("domain.competitors.cache-write failed:", error);
    }),
  );
  return result;
}

export async function getSubdomains(
  input: DomainReportInput,
  billingCustomer: BillingCustomerContext,
) {
  const domain = normalizeDomainInput(input.domain, true);
  const cacheKey = await buildCacheKey("domain:subdomains", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
  const cached = subdomainsResultSchema.safeParse(await getCached(cacheKey));
  if (cached.success) return cached.data;

  const dataforseo = createDataforseoClient(billingCustomer);
  const response = await dataforseo.domain.subdomains({
    target: domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: 100,
    orderBy: ["metrics.organic.etv,desc"],
  });

  const result = {
    domain,
    subdomains: response.items.flatMap((item) => {
      if (!item.subdomain) return [];
      return [
        {
          subdomain: item.subdomain,
          organicTraffic: metricCount(item.metrics?.organic?.etv),
          organicKeywords: metricCount(item.metrics?.organic?.count),
        },
      ];
    }),
    fetchedAt: new Date().toISOString(),
  };

  waitUntil(
    setCached(cacheKey, result, REPORT_TTL_SECONDS).catch((error) => {
      console.error("domain.subdomains.cache-write failed:", error);
    }),
  );
  return result;
}

export async function getCompareDomains(
  input: {
    projectId: string;
    domains: string[];
    includeSubdomains: boolean;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: BillingCustomerContext,
) {
  const domains = [
    ...new Set(
      input.domains.map((domain) =>
        normalizeDomainInput(domain, input.includeSubdomains),
      ),
    ),
  ].slice(0, 5);
  const cacheKey = await buildCacheKey("domain:compare", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domains,
    includeSubdomains: input.includeSubdomains,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
  const cached = compareResultSchema.safeParse(await getCached(cacheKey));
  if (cached.success) return cached.data;

  const dataforseo = createDataforseoClient(billingCustomer);
  const response = await dataforseo.domain.bulkTrafficEstimation({
    targets: domains,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });

  const byTarget = new Map(
    response.map((item) => [item.target ?? "", item] as const),
  );
  const result = {
    domains: domains.map((domain) => {
      const item = byTarget.get(domain);
      return {
        domain,
        organicTraffic: metricCount(item?.metrics?.organic?.etv),
        organicKeywords: metricCount(item?.metrics?.organic?.count),
        trafficCost: null,
      };
    }),
    fetchedAt: new Date().toISOString(),
  };

  waitUntil(
    setCached(cacheKey, result, REPORT_TTL_SECONDS).catch((error) => {
      console.error("domain.compare.cache-write failed:", error);
    }),
  );
  return result;
}

export async function getHistoricalOverview(
  input: DomainReportInput,
  billingCustomer: BillingCustomerContext,
) {
  const domain = normalizeDomainInput(input.domain, input.includeSubdomains);
  const cacheKey = await buildCacheKey("domain:historical-overview", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    includeSubdomains: input.includeSubdomains,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
  const cached = historyResultSchema.safeParse(await getCached(cacheKey));
  if (cached.success) return cached.data;

  const dataforseo = createDataforseoClient(billingCustomer);
  const items = await dataforseo.domain.historicalRankOverview({
    target: domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });

  const months = [];
  for (const item of items) {
    const year = item.year;
    const month = item.month;
    if (year == null || month == null) continue;
    const organic = item.metrics?.organic;
    months.push({
      year,
      month,
      organicTraffic: metricCount(organic?.etv),
      organicKeywords: metricCount(organic?.count),
      trafficCost:
        organic?.estimated_paid_traffic_cost != null
          ? Math.round(organic.estimated_paid_traffic_cost * 100) / 100
          : null,
      newKeywords: metricCount(organic?.is_new),
      lostKeywords: metricCount(organic?.is_lost),
      improvedKeywords: metricCount(organic?.is_up),
      declinedKeywords: metricCount(organic?.is_down),
    });
  }

  const result = {
    domain,
    months,
    fetchedAt: new Date().toISOString(),
  };

  waitUntil(
    setCached(cacheKey, result, REPORT_TTL_SECONDS).catch((error) => {
      console.error("domain.historical-overview.cache-write failed:", error);
    }),
  );
  return result;
}
