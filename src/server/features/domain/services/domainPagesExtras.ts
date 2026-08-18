import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import type { RelevantPagesItem } from "@/server/lib/dataforseo";
import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { normalizeDomainInput, toRelativePath } from "@/server/lib/domainUtils";
import {
  DomainResearchRepository,
  periodKeyFromDate,
} from "@/server/features/domain/repositories/DomainResearchRepository";

const PAGE_EXTRAS_TTL_SECONDS = 12 * 60 * 60;

const pagesExtrasResultSchema = z.object({
  domain: z.string(),
  currentPeriod: z.string(),
  previousPeriod: z.string().nullable(),
  pages: z.array(
    z.object({
      page: z.string(),
      relativePath: z.string().nullable(),
      organicTraffic: z.number().nullable(),
      keywords: z.number().nullable(),
      status: z.enum(["new", "lost", "existing"]),
      previousTraffic: z.number().nullable(),
      trafficDelta: z.number().nullable(),
    }),
  ),
  fetchedAt: z.string(),
});

const PAGE_SNAPSHOT_LIMIT = 100;

function mapPageItem(item: RelevantPagesItem) {
  const url = item.page_address ?? null;
  if (!url) return null;
  const organic = item.metrics?.organic ?? null;
  return {
    page: url,
    relativePath: toRelativePath(url),
    organicTraffic: organic?.etv != null ? Math.round(organic.etv) : null,
    keywords: organic?.count != null ? Math.round(organic.count) : null,
  };
}

export async function getPagesExtras(
  input: {
    projectId: string;
    domain: string;
    includeSubdomains: boolean;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: BillingCustomerContext,
) {
  const domain = normalizeDomainInput(input.domain, input.includeSubdomains);
  const cacheKey = await buildCacheKey("domain:pages-extras", {
    organizationId: billingCustomer.organizationId,
    projectId: input.projectId,
    domain,
    includeSubdomains: input.includeSubdomains,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });
  const cached = pagesExtrasResultSchema.safeParse(await getCached(cacheKey));
  if (cached.success) return cached.data;

  const dataforseo = createDataforseoClient(billingCustomer);
  const response = await dataforseo.domain.relevantPages({
    target: domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    limit: PAGE_SNAPSHOT_LIMIT,
    orderBy: ["metrics.organic.etv,desc"],
  });

  const currentPages = response.items
    .map(mapPageItem)
    .filter(
      (item): item is NonNullable<ReturnType<typeof mapPageItem>> =>
        item != null,
    );

  const snapshotId = await DomainResearchRepository.upsertSnapshot(
    {
      projectId: input.projectId,
      domain,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      includeSubdomains: input.includeSubdomains,
      periodKey: periodKeyFromDate(),
    },
    { organicTraffic: null, organicKeywords: null, trafficCost: null },
  );
  await DomainResearchRepository.replaceSnapshotPages(
    snapshotId,
    currentPages.map((page) => ({
      pageUrl: page.page,
      organicTraffic: page.organicTraffic,
      keywords: page.keywords,
    })),
  );
  await DomainResearchRepository.prune(input.projectId);

  const snapshots = await DomainResearchRepository.listSnapshots({
    projectId: input.projectId,
    domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    includeSubdomains: input.includeSubdomains,
  });
  const previous = snapshots.find((snapshot) => snapshot.id !== snapshotId);
  const previousPages = previous
    ? await DomainResearchRepository.listSnapshotPages(previous.id)
    : [];
  const previousByUrl = new Map(
    previousPages.map((page) => [page.pageUrl, page]),
  );
  const currentUrls = new Set(currentPages.map((page) => page.page));

  const pages = currentPages.map((page) => {
    const prior = previousByUrl.get(page.page);
    const previousTraffic = prior?.organicTraffic ?? null;
    return {
      ...page,
      status: prior ? ("existing" as const) : ("new" as const),
      previousTraffic,
      trafficDelta:
        page.organicTraffic != null && previousTraffic != null
          ? page.organicTraffic - previousTraffic
          : page.organicTraffic,
    };
  });

  const lostPages = previousPages
    .filter((page) => !currentUrls.has(page.pageUrl))
    .map((page) => ({
      page: page.pageUrl,
      relativePath: toRelativePath(page.pageUrl),
      organicTraffic: 0,
      keywords: page.keywords,
      status: "lost" as const,
      previousTraffic: page.organicTraffic,
      trafficDelta: page.organicTraffic != null ? -page.organicTraffic : null,
    }));

  const result = {
    domain,
    currentPeriod: periodKeyFromDate(),
    previousPeriod: previous?.periodKey ?? null,
    pages: [...pages, ...lostPages],
    fetchedAt: new Date().toISOString(),
  };

  waitUntil(
    setCached(cacheKey, result, PAGE_EXTRAS_TTL_SECONDS).catch((error) => {
      console.error("domain.pages-extras.cache-write failed:", error);
    }),
  );
  return result;
}
