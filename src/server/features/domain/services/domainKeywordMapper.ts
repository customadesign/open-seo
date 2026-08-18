import { type DomainRankedKeywordItem } from "@/server/lib/dataforseo";
import { toRelativePath } from "@/server/lib/domainUtils";

export const SEARCH_INTENTS = [
  "informational",
  "navigational",
  "commercial",
  "transactional",
] as const;

export type SearchIntent = (typeof SEARCH_INTENTS)[number];

export type PositionChangeKind = "new" | "lost" | "improved" | "declined";

export function normalizeSearchIntent(
  value: string | null | undefined,
): SearchIntent | null {
  if (
    value === "informational" ||
    value === "navigational" ||
    value === "commercial" ||
    value === "transactional"
  ) {
    return value;
  }
  return null;
}

export function classifyPositionChange(input: {
  isLost: boolean;
  isNew: boolean;
  isUp: boolean;
  isDown: boolean;
}): PositionChangeKind | null {
  if (input.isLost) return "lost";
  if (input.isNew) return "new";
  if (input.isUp) return "improved";
  if (input.isDown) return "declined";
  return null;
}

function roundNullable(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Math.round(value);
}

function firstNumber(
  ...values: Array<number | null | undefined>
): number | null {
  return values.find((value) => value != null) ?? null;
}

function firstString(
  ...values: Array<string | null | undefined>
): string | null {
  return values.find((value) => value != null && value !== "") ?? null;
}

export function mapKeywordItem(item: DomainRankedKeywordItem) {
  const keywordData = item.keyword_data;
  const rankedSerpElement = item.ranked_serp_element;
  const serpItem = rankedSerpElement?.serp_item;
  const rankChanges = serpItem?.rank_changes;
  const keyword = firstString(keywordData?.keyword, item.keyword);
  if (!keyword) return null;

  const url = firstString(serpItem?.url, rankedSerpElement?.url);
  return {
    keyword,
    position: roundNullable(
      firstNumber(serpItem?.rank_absolute, rankedSerpElement?.rank_absolute),
    ),
    previousPosition: roundNullable(rankChanges?.previous_rank_absolute),
    searchVolume: roundNullable(keywordData?.keyword_info?.search_volume),
    traffic: firstNumber(serpItem?.etv, rankedSerpElement?.etv),
    trafficCost: serpItem?.estimated_paid_traffic_cost ?? null,
    cpc: keywordData?.keyword_info?.cpc ?? null,
    url,
    relativeUrl: firstString(
      serpItem?.relative_url,
      rankedSerpElement?.relative_url,
      url ? toRelativePath(url) : null,
    ),
    keywordDifficulty: roundNullable(
      firstNumber(
        keywordData?.keyword_properties?.keyword_difficulty,
        keywordData?.keyword_info?.keyword_difficulty,
      ),
    ),
    intent: normalizeSearchIntent(keywordData?.search_intent_info?.main_intent),
    change: classifyPositionChange({
      isLost: rankedSerpElement?.is_lost === true,
      isNew: rankChanges?.is_new === true,
      isUp: rankChanges?.is_up === true,
      isDown: rankChanges?.is_down === true,
    }),
    occupiedType: serpItem?.type ?? null,
    serpFeatures: rankedSerpElement?.serp_item_types ?? [],
    lastUpdatedTime: rankedSerpElement?.last_updated_time ?? null,
    previousUpdatedTime: rankedSerpElement?.previous_updated_time ?? null,
  };
}
