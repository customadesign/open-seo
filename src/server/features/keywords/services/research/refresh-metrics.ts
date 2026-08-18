import { KeywordResearchRepository } from "@/server/features/keywords/repositories/KeywordResearchRepository";
import { normalizeIntent } from "@/server/features/keywords/services/research/helpers";
import {
  createDataforseoClient,
  fetchKeywordMetricsForList,
} from "@/server/lib/dataforseo";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { RefreshSavedKeywordMetricsInput } from "@/types/schemas/keywords";

// Cap concurrent D1 upserts per group. A project can accumulate thousands of
// saved keywords in one location/language, and fanning out one promise each
// would flood D1/Worker resources; write in bounded chunks instead.
const REFRESH_UPSERT_BATCH_SIZE = 100;

export async function refreshKeywordMetricsForList(
  input: {
    projectId: string;
    keywords: string[];
    locationCode: number;
    languageCode: string;
  },
  billingCustomer: BillingCustomerContext,
): Promise<{
  updated: number;
  metrics: Map<
    string,
    {
      searchVolume: number | null;
      cpc: number | null;
      competition: number | null;
      keywordDifficulty: number | null;
      intent: string | null;
      monthlySearches: unknown;
    }
  >;
}> {
  if (input.keywords.length === 0) {
    return { updated: 0, metrics: new Map() };
  }

  const client = createDataforseoClient(billingCustomer);
  const fetched = await fetchKeywordMetricsForList(client, {
    keywords: input.keywords,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    creditFeature: "keyword_research",
  });
  const metrics = new Map(
    fetched.map((metric) => [metric.keyword.toLowerCase(), metric]),
  );

  for (let i = 0; i < input.keywords.length; i += REFRESH_UPSERT_BATCH_SIZE) {
    const chunk = input.keywords.slice(i, i + REFRESH_UPSERT_BATCH_SIZE);
    await Promise.all(
      chunk.map((keyword) => {
        const metric = metrics.get(keyword.toLowerCase());
        if (!metric) return Promise.resolve();
        return KeywordResearchRepository.upsertKeywordMetric({
          projectId: input.projectId,
          keyword,
          locationCode: input.locationCode,
          languageCode: input.languageCode,
          searchVolume: metric.searchVolume,
          cpc: metric.cpc,
          competition: metric.competition,
          keywordDifficulty: metric.keywordDifficulty,
          intent: normalizeIntent(metric.intent),
          monthlySearchesJson: JSON.stringify(metric.monthlySearches),
        });
      }),
    );
  }

  return { updated: metrics.size, metrics };
}

export async function refreshSavedKeywordMetrics(
  input: RefreshSavedKeywordMetricsInput,
  billingCustomer: BillingCustomerContext,
): Promise<{ updated: number }> {
  const { rows } = await KeywordResearchRepository.listSavedKeywordsByProject({
    projectId: input.projectId,
  });

  const selected = input.keywords?.map((keyword) => keyword.toLowerCase());
  const selectedSet =
    selected && selected.length > 0 ? new Set(selected) : null;
  const filtered =
    selectedSet == null
      ? rows
      : rows.filter((row) => selectedSet.has(row.row.keyword.toLowerCase()));

  if (filtered.length === 0) return { updated: 0 };

  let updated = 0;
  const groups = new Map<string, typeof filtered>();
  for (const row of filtered) {
    const key = `${row.row.locationCode}:${row.row.languageCode}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const groupRows of groups.values()) {
    const { locationCode, languageCode } = groupRows[0].row;
    const result = await refreshKeywordMetricsForList(
      {
        projectId: input.projectId,
        keywords: groupRows.map((row) => row.row.keyword),
        locationCode,
        languageCode,
      },
      billingCustomer,
    );
    updated += result.updated;
  }

  return { updated };
}
