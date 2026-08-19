import { mapKeywordItem } from "@/server/features/domain/services/domainKeywordMapper";
import type { DomainRankedKeywordItem } from "@/server/lib/dataforseo";

export function mapKeywordGapItem(item: DomainRankedKeywordItem) {
  const mapped = mapKeywordItem(item);
  if (!mapped) return null;
  return {
    ...mapped,
    intent: item.keyword_data?.search_intent_info?.main_intent ?? null,
  };
}
