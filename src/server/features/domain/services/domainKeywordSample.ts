import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { normalizeDomainInput } from "@/server/lib/domainUtils";
import { mapKeywordItem } from "@/server/features/domain/services/domainKeywordMapper";
import {
  SEARCH_INTENTS,
  type PositionChangeKind,
  type SearchIntent,
} from "@/server/features/domain/services/domainKeywordMapper";

export const DOMAIN_KEYWORD_SAMPLE_LIMIT = 1000;
const DOMAIN_KEYWORD_SAMPLE_TTL_SECONDS = 12 * 60 * 60;

const mappedKeywordSchema = z.object({
  keyword: z.string(),
  position: z.number().nullable(),
  previousPosition: z.number().nullable(),
  searchVolume: z.number().nullable(),
  traffic: z.number().nullable(),
  trafficCost: z.number().nullable(),
  cpc: z.number().nullable(),
  url: z.string().nullable(),
  relativeUrl: z.string().nullable(),
  keywordDifficulty: z.number().nullable(),
  intent: z.enum(SEARCH_INTENTS).nullable(),
  change: z.enum(["new", "lost", "improved", "declined"]).nullable(),
  occupiedType: z.string().nullable(),
  serpFeatures: z.array(z.string()),
  lastUpdatedTime: z.string().nullable(),
  previousUpdatedTime: z.string().nullable(),
});

const domainKeywordSampleSchema = z.object({
  domain: z.string(),
  live: z.array(mappedKeywordSchema),
  lost: z.array(mappedKeywordSchema),
  lastUpdatedTime: z.string().nullable(),
  previousUpdatedTime: z.string().nullable(),
  fetchedAt: z.string(),
});

export type MappedDomainKeyword = z.infer<typeof mappedKeywordSchema>;
export type DomainKeywordSample = z.infer<typeof domainKeywordSampleSchema>;

function mapItems(
  items: Parameters<typeof mapKeywordItem>[0][],
): MappedDomainKeyword[] {
  return items
    .map((item) => mapKeywordItem(item))
    .filter((item): item is NonNullable<ReturnType<typeof mapKeywordItem>> => {
      if (item == null) return false;
      return mappedKeywordSchema.safeParse(item).success;
    });
}

export async function getRankedKeywordSample(
  input: {
    projectId: string;
    domain: string;
    includeSubdomains: boolean;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: BillingCustomerContext,
): Promise<DomainKeywordSample> {
  const domain = normalizeDomainInput(input.domain, input.includeSubdomains);
  const cacheKey = await buildCacheKey("domain:keyword-sample", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    includeSubdomains: input.includeSubdomains,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });

  const cachedRaw = await getCached(cacheKey);
  const cached = domainKeywordSampleSchema.safeParse(cachedRaw);
  if (cached.success) return cached.data;

  const dataforseo = createDataforseoClient(billingCustomer);
  const [liveResponse, lostResponse] = await Promise.all([
    dataforseo.domain.rankedKeywords({
      target: domain,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      limit: DOMAIN_KEYWORD_SAMPLE_LIMIT,
      orderBy: ["ranked_serp_element.serp_item.etv,desc"],
      itemTypes: ["organic", "featured_snippet", "local_pack"],
      includeSubdomains: input.includeSubdomains,
      historicalSerpMode: "live",
    }),
    dataforseo.domain.rankedKeywords({
      target: domain,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      limit: DOMAIN_KEYWORD_SAMPLE_LIMIT,
      orderBy: ["ranked_serp_element.serp_item.etv,desc"],
      itemTypes: ["organic", "featured_snippet", "local_pack"],
      includeSubdomains: input.includeSubdomains,
      historicalSerpMode: "lost",
    }),
  ]);

  const live = mapItems(liveResponse.items);
  const lost = mapItems(lostResponse.items).map((item) => ({
    ...item,
    change: "lost" as const,
  }));

  const result: DomainKeywordSample = {
    domain,
    live,
    lost,
    lastUpdatedTime:
      live.find((item) => item.lastUpdatedTime)?.lastUpdatedTime ??
      lost.find((item) => item.lastUpdatedTime)?.lastUpdatedTime ??
      null,
    previousUpdatedTime:
      live.find((item) => item.previousUpdatedTime)?.previousUpdatedTime ??
      lost.find((item) => item.previousUpdatedTime)?.previousUpdatedTime ??
      null,
    fetchedAt: new Date().toISOString(),
  };

  waitUntil(
    setCached(cacheKey, result, DOMAIN_KEYWORD_SAMPLE_TTL_SECONDS).catch(
      (error) => {
        console.error("domain.keyword-sample.cache-write failed:", error);
      },
    ),
  );

  return result;
}

export function trafficImpact(
  previousPosition: number | null,
  currentPosition: number | null,
  searchVolume: number | null,
): number | null {
  if (searchVolume == null) return null;
  const previousShare =
    previousPosition == null ? 0 : ctrShare(previousPosition);
  const currentShare = currentPosition == null ? 0 : ctrShare(currentPosition);
  return Math.round((currentShare - previousShare) * searchVolume);
}

function ctrShare(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 3) return 0.15;
  if (position <= 10) return 0.05;
  if (position <= 20) return 0.02;
  return 0.005;
}

export type { PositionChangeKind, SearchIntent };
