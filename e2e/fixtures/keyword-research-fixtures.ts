import type { KeywordResearchRow } from "@/types/keywords";
import type { ResolvedResearchKeywordsInput } from "@/types/schemas/keywords";

const MONTHLY_SEARCHES = [
  { year: 2025, month: 4, searchVolume: 1200 },
  { year: 2025, month: 5, searchVolume: 1600 },
  { year: 2025, month: 6, searchVolume: 2400 },
  { year: 2025, month: 7, searchVolume: 3200 },
  { year: 2025, month: 8, searchVolume: 4200 },
  { year: 2025, month: 9, searchVolume: 3600 },
  { year: 2025, month: 10, searchVolume: 3000 },
  { year: 2025, month: 11, searchVolume: 2600 },
  { year: 2025, month: 12, searchVolume: 2200 },
  { year: 2026, month: 1, searchVolume: 2100 },
  { year: 2026, month: 2, searchVolume: 2300 },
  { year: 2026, month: 3, searchVolume: 2800 },
];

function makeRow(
  keyword: string,
  index: number,
  overrides: Partial<KeywordResearchRow> = {},
): KeywordResearchRow {
  return {
    keyword,
    searchVolume: 20_000 - index * 750,
    trend: MONTHLY_SEARCHES,
    keywordDifficulty: 40 + (index % 40),
    cpc: Number((1.25 + index * 0.15).toFixed(2)),
    competition: Number((0.05 + (index % 10) * 0.04).toFixed(2)),
    intent: index % 3 === 0 ? "commercial" : "informational",
    ...overrides,
  };
}

export function getKeywordResearchFixture(data: ResolvedResearchKeywordsInput) {
  const seedKeyword = data.keywords[0] ?? "keyword research";
  const rows = [
    makeRow(seedKeyword, 0, {
      searchVolume: 288_431,
      keywordDifficulty: 78,
      cpc: 11.93,
      competition: 0.07,
      intent: "informational",
    }),
    makeRow(`${seedKeyword} tools`, 1),
    makeRow(`${seedKeyword} software`, 2),
    makeRow(`${seedKeyword} checklist`, 3),
    makeRow(`${seedKeyword} template`, 4),
    makeRow(`${seedKeyword} examples`, 5),
    makeRow(`${seedKeyword} guide`, 6),
    makeRow(`${seedKeyword} strategy`, 7),
    makeRow(`${seedKeyword} platform`, 8),
    makeRow(`${seedKeyword} generator`, 9),
  ];

  return {
    rows,
    source: "related" as const,
    usedFallback: false,
    diagnostics: {
      requestedMode: data.mode,
      threshold: 3,
      sourceAttempts: [
        {
          source: "related" as const,
          rowCount: rows.length,
          nonSeedCount: rows.length - 1,
        },
      ],
    },
  };
}

export function getKeywordMagicRunFixture(input: {
  seed: string;
  locationCode: number;
  languageCode: string;
  clickstream?: boolean;
  maxKeywords?: number;
}) {
  return {
    id: "e2e-keyword-magic",
    seed: input.seed,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    clickstream: input.clickstream ?? false,
    maxKeywords: input.maxKeywords ?? 10_000,
    keywordCount: 10,
    provider: "labs" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

export function getKeywordMagicPageFixture(input: {
  projectId: string;
  runId?: string;
  page?: number;
  pageSize?: number;
  seed?: string;
}) {
  const seed = input.seed ?? "keyword research";
  const research = getKeywordResearchFixture({
    projectId: input.projectId,
    keywords: [seed],
    locationCode: 2840,
    languageCode: "en",
    resultLimit: 150,
    mode: "auto",
    clickstream: false,
  });
  const rows = research.rows.map((row) => ({
    keyword: row.keyword,
    searchVolume: row.searchVolume,
    cpc: row.cpc,
    competition: row.competition,
    keywordDifficulty: row.keywordDifficulty,
    intent: row.intent,
    wordCount: row.keyword.split(/\s+/).length,
    serpFeatures: [] as string[],
    metricsUpdatedAt: "2026-01-01T00:00:00.000Z",
    clusterId: "e2e-cluster",
    clusterName: "Keyword Research",
  }));
  return {
    run: getKeywordMagicRunFixture({
      seed,
      locationCode: 2840,
      languageCode: "en",
    }),
    rows,
    clusters: [
      {
        id: "e2e-cluster",
        name: "Keyword Research",
        keywordCount: rows.length,
      },
    ],
    totalCount: rows.length,
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 50,
    hasMore: false,
    matchType: "all" as const,
  };
}
