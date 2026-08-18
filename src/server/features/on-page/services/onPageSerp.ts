import type { BillingCustomerContext } from "@/server/billing/subscription";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import {
  estimateOnPageSerpCredits,
  MAX_ON_PAGE_PAGES_PER_RUN,
  ON_PAGE_SERP_DEPTH,
  onPageSerpCacheDate,
} from "@/shared/on-page";
import { OnPageRepository } from "../repositories/OnPageRepository";
import type { OnPageEvidence } from "./onPageIdeas";

export type SerpOrganicItem = {
  rank: number;
  title: string;
  url: string;
  domain: string;
};

function isEvidenceValue(value: unknown): value is OnPageEvidence[string] {
  if (value == null) return true;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" || typeof item === "number")
  );
}

export function parseEvidence(raw: string): OnPageEvidence {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const evidence: OnPageEvidence = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isEvidenceValue(value)) evidence[key] = value;
    }
    return evidence;
  } catch {
    return {};
  }
}

function field(value: object, key: string): unknown {
  return Object.fromEntries(Object.entries(value))[key];
}

export function parseSerpItems(raw: string): SerpOrganicItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items: SerpOrganicItem[] = [];
    for (const rawItem of parsed) {
      const item: unknown = rawItem;
      if (!item || typeof item !== "object") continue;
      const url = field(item, "url");
      const rank = field(item, "rank");
      const title = field(item, "title");
      const domain = field(item, "domain");
      if (
        typeof url !== "string" ||
        typeof rank !== "number" ||
        typeof title !== "string" ||
        typeof domain !== "string"
      ) {
        continue;
      }
      items.push({ rank, title, url, domain });
    }
    return items;
  } catch {
    return [];
  }
}

export async function countUncachedKeywords(
  pages: Array<{
    keywords: Array<{
      keyword: string;
      locationCode: number;
      languageCode: string;
    }>;
  }>,
) {
  const fetchedDate = onPageSerpCacheDate();
  const seen = new Set<string>();
  let uncached = 0;
  const limited = pages.slice(0, MAX_ON_PAGE_PAGES_PER_RUN);
  for (const page of limited) {
    for (const keyword of page.keywords) {
      const key = `${keyword.keyword}|${keyword.locationCode}|${keyword.languageCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cached = await OnPageRepository.getSerpCache({
        keyword: keyword.keyword,
        locationCode: keyword.locationCode,
        languageCode: keyword.languageCode,
        fetchedDate,
      });
      if (!cached) uncached += 1;
    }
  }
  return {
    pageCap: MAX_ON_PAGE_PAGES_PER_RUN,
    pagesToProcess: limited.length,
    uniqueKeywords: seen.size,
    uncachedKeywords: uncached,
  };
}

export async function estimateOnPageRunCost(
  pages: Array<{
    keywords: Array<{
      keyword: string;
      locationCode: number;
      languageCode: string;
    }>;
  }>,
) {
  const counts = await countUncachedKeywords(pages);
  return { ...counts, ...estimateOnPageSerpCredits(counts.uncachedKeywords) };
}

export async function loadOrganicTop10(
  keyword: {
    keyword: string;
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: BillingCustomerContext,
): Promise<{ items: SerpOrganicItem[]; fetched: boolean }> {
  const fetchedDate = onPageSerpCacheDate();
  const cached = await OnPageRepository.getSerpCache({
    keyword: keyword.keyword,
    locationCode: keyword.locationCode,
    languageCode: keyword.languageCode,
    fetchedDate,
  });
  if (cached)
    return { items: parseSerpItems(cached.resultsJson), fetched: false };

  const liveItems = await createDataforseoClient(billingCustomer).serp.live({
    keyword: keyword.keyword,
    locationCode: keyword.locationCode,
    languageCode: keyword.languageCode,
    depth: ON_PAGE_SERP_DEPTH,
  });
  const items = liveItems
    .filter((item) => item.type === "organic" && item.url)
    .slice(0, 10)
    .map((item) => ({
      rank: item.rank_group ?? item.rank_absolute ?? 0,
      title: item.title ?? "",
      url: item.url ?? "",
      domain: item.domain ?? "",
    }));
  await OnPageRepository.saveSerpCache({
    id: crypto.randomUUID(),
    keyword: keyword.keyword,
    locationCode: keyword.locationCode,
    languageCode: keyword.languageCode,
    fetchedDate,
    resultsJson: JSON.stringify(items),
  });
  return { items, fetched: true };
}
