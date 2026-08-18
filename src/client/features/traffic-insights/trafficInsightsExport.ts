import { buildCsv, downloadCsv, type CsvValue } from "@/client/lib/csv";
import { captureClientEvent } from "@/client/lib/posthog";
import type { TrafficInsightsResult } from "@/server/features/traffic-insights/services/OrganicTrafficInsightsService";

const HEADERS = [
  "Landing page",
  "Sessions",
  "Engagement rate",
  "Key events",
  "Clicks",
  "Impressions",
  "CTR",
  "Average position",
  "Queries",
  "Tracked keywords",
  "Keyword count",
  "Best position",
  "Sources",
];

function cell(value: number | null): CsvValue {
  return value;
}

export function exportTrafficInsightsCsv(result: TrafficInsightsResult): void {
  const rows = result.rows.map((row) => [
    row.url,
    cell(row.sessions),
    cell(row.engagementRate),
    cell(row.keyEvents),
    cell(row.clicks),
    cell(row.impressions),
    cell(row.ctr),
    cell(row.averagePosition),
    row.queries.map((query) => query.query).join("; "),
    row.trackedKeywords.map((keyword) => keyword.keyword).join("; "),
    cell(row.keywordCount),
    cell(row.bestPosition),
    row.coverage.join("+"),
  ]);
  downloadCsv(
    `traffic-insights-${result.range.startDate}-to-${result.range.endDate}.csv`,
    buildCsv(HEADERS, rows),
  );
  captureClientEvent("data:export", {
    source_feature: "traffic_insights",
    result_count: rows.length,
  });
}
