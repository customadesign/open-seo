import { createDataforseoClient } from "@/server/lib/dataforseo";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { CreditFeature } from "@/shared/billing-credit-features";
import {
  KEYWORD_MAGIC_MAX_KEYWORDS,
  KEYWORD_MAGIC_PROVIDER_PAGE_SIZE,
} from "@/shared/keyword-magic";
import { mapAdsItemToMagicRow, mapLabsItemToMagicRow } from "./map-items";
import type { KeywordMagicInsertKeyword } from "../../repositories/KeywordMagicRepository";

type FetchParams = {
  seed: string;
  locationCode: number;
  languageCode: string;
  maxKeywords: number;
  clickstream: boolean;
  creditFeature?: CreditFeature;
};

function takeUnique(
  existing: Map<string, KeywordMagicInsertKeyword>,
  incoming: KeywordMagicInsertKeyword[],
  cap: number,
) {
  for (const row of incoming) {
    if (existing.size >= cap) return;
    if (existing.has(row.keyword)) continue;
    existing.set(row.keyword, row);
  }
}

export async function fetchLabsMagicRows(
  params: FetchParams,
  billingCustomer: BillingCustomerContext,
): Promise<KeywordMagicInsertKeyword[]> {
  const dataforseo = createDataforseoClient(billingCustomer);
  const cap = Math.min(params.maxKeywords, KEYWORD_MAGIC_MAX_KEYWORDS);
  const collected = new Map<string, KeywordMagicInsertKeyword>();
  const pageSize = KEYWORD_MAGIC_PROVIDER_PAGE_SIZE;

  for (let offset = 0; collected.size < cap; offset += pageSize) {
    const items = await dataforseo.keywords.suggestions({
      keyword: params.seed,
      locationCode: params.locationCode,
      languageCode: params.languageCode,
      limit: pageSize,
      offset,
      exactMatch: false,
      includeClickstreamData: params.clickstream,
      includeSerpInfo: true,
      creditFeature: params.creditFeature,
    });
    const mapped = items
      .map((item) => mapLabsItemToMagicRow(item, params.seed, "suggestions"))
      .filter((row): row is KeywordMagicInsertKeyword => row != null);
    const before = collected.size;
    takeUnique(collected, mapped, cap);
    if (items.length < pageSize || collected.size === before) break;
  }

  if (collected.size < cap) {
    const related = await dataforseo.keywords.related({
      keyword: params.seed,
      locationCode: params.locationCode,
      languageCode: params.languageCode,
      limit: pageSize,
      depth: 3,
      includeClickstreamData: params.clickstream,
      includeSerpInfo: true,
      creditFeature: params.creditFeature,
    });
    takeUnique(
      collected,
      related
        .map((item) => item.keyword_data)
        .filter((data): data is NonNullable<typeof data> => data != null)
        .map((data) => mapLabsItemToMagicRow(data, params.seed, "related"))
        .filter((row): row is KeywordMagicInsertKeyword => row != null),
      cap,
    );
  }

  if (collected.size < cap) {
    const ideas = await dataforseo.keywords.ideas({
      keyword: params.seed,
      locationCode: params.locationCode,
      languageCode: params.languageCode,
      limit: pageSize,
      includeClickstreamData: params.clickstream,
      includeSerpInfo: true,
      creditFeature: params.creditFeature,
    });
    takeUnique(
      collected,
      ideas
        .map((item) => mapLabsItemToMagicRow(item, params.seed, "ideas"))
        .filter((row): row is KeywordMagicInsertKeyword => row != null),
      cap,
    );
  }

  return [...collected.values()];
}

export async function fetchAdsMagicRows(
  params: Omit<FetchParams, "clickstream">,
  billingCustomer: BillingCustomerContext,
): Promise<KeywordMagicInsertKeyword[]> {
  const dataforseo = createDataforseoClient(billingCustomer);
  const items = await dataforseo.keywords.adsIdeas({
    keyword: params.seed,
    locationCode: params.locationCode,
    languageCode: params.languageCode,
    limit: Math.min(params.maxKeywords, KEYWORD_MAGIC_MAX_KEYWORDS),
    creditFeature: params.creditFeature,
  });
  return items
    .map((item) => mapAdsItemToMagicRow(item, params.seed))
    .filter((row): row is KeywordMagicInsertKeyword => row != null);
}
