import type { KeywordIntent } from "@/types/keywords";
import type {
  KeywordMagicMatchType,
  KeywordMagicPageSize,
} from "@/shared/keyword-magic";

export type KeywordMagicSortField =
  | "keyword"
  | "searchVolume"
  | "cpc"
  | "competition"
  | "keywordDifficulty"
  | "wordCount"
  | "metricsUpdatedAt";

export type KeywordMagicClusterSummary = {
  id: string;
  name: string;
  keywordCount: number;
};

export type KeywordMagicRow = {
  keyword: string;
  searchVolume: number | null;
  cpc: number | null;
  competition: number | null;
  keywordDifficulty: number | null;
  intent: KeywordIntent;
  wordCount: number;
  serpFeatures: string[];
  metricsUpdatedAt: string | null;
  clusterId: string | null;
  clusterName: string | null;
};

export type KeywordMagicRunSummary = {
  id: string;
  seed: string;
  locationCode: number;
  languageCode: string;
  clickstream: boolean;
  maxKeywords: number;
  keywordCount: number;
  provider: "labs" | "google_ads";
  createdAt: string;
  expiresAt: string;
};

export type KeywordMagicPageResult = {
  run: KeywordMagicRunSummary;
  rows: KeywordMagicRow[];
  clusters: KeywordMagicClusterSummary[];
  totalCount: number;
  page: number;
  pageSize: KeywordMagicPageSize;
  hasMore: boolean;
  matchType: KeywordMagicMatchType;
};

export type KeywordMagicFilters = {
  matchType?: KeywordMagicMatchType;
  clusterId?: string;
  includeTerms?: string[];
  excludeTerms?: string[];
  minVolume?: number | null;
  maxVolume?: number | null;
  minCpc?: number | null;
  maxCpc?: number | null;
  minDifficulty?: number | null;
  maxDifficulty?: number | null;
  minWordCount?: number | null;
  maxWordCount?: number | null;
  intents?: KeywordIntent[];
  serpFeatures?: string[];
};
