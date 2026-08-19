import type { LabsKeywordDataItem } from "@/server/lib/dataforseo";
import type { AdsKeywordIdeaItem } from "@/server/lib/dataforseo";
import { normalizeIntent, normalizeKeyword } from "../research/helpers";
import {
  isBroadMatch,
  isExactMatch,
  isPhraseMatch,
  isQuestionKeyword,
  keywordWordCount,
} from "./match-types";
import type { KeywordMagicInsertKeyword } from "../../repositories/KeywordMagicRepository";

export type MagicSource = KeywordMagicInsertKeyword["source"];

function readSerpFeatures(item: LabsKeywordDataItem): string[] {
  const raw = item.serp_info?.serp_item_types ?? [];
  const features = new Set<string>();
  for (const feature of raw) {
    if (typeof feature === "string" && feature.length > 0) {
      features.add(feature);
    }
  }
  return [...features].toSorted((left, right) => left.localeCompare(right));
}

function readMetricsUpdatedAt(item: LabsKeywordDataItem): string | null {
  return (
    item.serp_info?.last_updated_time ??
    item.keyword_info?.last_updated_time ??
    null
  );
}

export function mapLabsItemToMagicRow(
  item: LabsKeywordDataItem,
  seed: string,
  source: Exclude<MagicSource, "google_ads">,
): KeywordMagicInsertKeyword | null {
  const keyword = item.keyword;
  if (!keyword) return null;
  const normalized = normalizeKeyword(keyword);
  if (!normalized) return null;

  const keywordInfo = item.keyword_info_normalized_with_clickstream
    ?.search_volume
    ? item.keyword_info_normalized_with_clickstream
    : item.keyword_info;

  return {
    keyword: normalized,
    searchVolume: keywordInfo?.search_volume ?? null,
    cpc: item.keyword_info?.cpc ?? null,
    competition: item.keyword_info?.competition ?? null,
    keywordDifficulty: item.keyword_properties?.keyword_difficulty ?? null,
    intent: normalizeIntent(item.search_intent_info?.main_intent),
    wordCount: keywordWordCount(normalized),
    isBroad: isBroadMatch(normalized, seed),
    isPhrase: isPhraseMatch(normalized, seed),
    isExact: isExactMatch(normalized, seed),
    isQuestion: isQuestionKeyword(normalized),
    source,
    metricsUpdatedAt: readMetricsUpdatedAt(item),
    serpFeatures: readSerpFeatures(item),
    clusterName: "",
  };
}

export function mapAdsItemToMagicRow(
  item: AdsKeywordIdeaItem,
  seed: string,
): KeywordMagicInsertKeyword | null {
  const keyword = item.keyword;
  if (!keyword) return null;
  const normalized = normalizeKeyword(keyword);
  if (!normalized) return null;

  return {
    keyword: normalized,
    searchVolume: item.search_volume ?? null,
    cpc: item.cpc ?? null,
    competition:
      item.competition_index != null ? item.competition_index / 100 : null,
    keywordDifficulty: null,
    intent: "unknown",
    wordCount: keywordWordCount(normalized),
    isBroad: isBroadMatch(normalized, seed),
    isPhrase: isPhraseMatch(normalized, seed),
    isExact: isExactMatch(normalized, seed),
    isQuestion: isQuestionKeyword(normalized),
    source: "google_ads",
    metricsUpdatedAt: null,
    serpFeatures: [],
    clusterName: "",
  };
}
