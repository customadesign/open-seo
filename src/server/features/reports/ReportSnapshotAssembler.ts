import type { ReportSectionKey, ReportSnapshot } from "@/types/schemas/reports";
import { reportSnapshotSchema } from "@/types/schemas/reports";
import { getReportProject, loadReportSection } from "./ReportSectionDataSource";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value,
  );
}

function sumBy<T>(items: readonly T[], pick: (item: T) => number) {
  return items.reduce((running, item) => running + pick(item), 0);
}

function direction(value: number | null, inverse = false) {
  if (value == null || value === 0) return "neutral" as const;
  const positive = inverse ? value < 0 : value > 0;
  return positive ? ("positive" as const) : ("negative" as const);
}

function buildEvidence(
  sections: ReportSnapshot["sections"],
): ReportSnapshot["evidence"] {
  const evidence: ReportSnapshot["evidence"] = [];
  for (const section of sections) {
    if (section.key === "rankings") {
      const improved = section.data.configs.reduce(
        (sum, config) => sum + config.summary.improved,
        0,
      );
      const declined = section.data.configs.reduce(
        (sum, config) => sum + config.summary.declined,
        0,
      );
      evidence.push({
        key: "rankings.movement",
        label: "Ranking movement",
        value: `${improved} improved, ${declined} declined`,
        direction:
          improved === declined
            ? "neutral"
            : improved > declined
              ? "positive"
              : "negative",
      });
    }
    if (section.key === "gsc") {
      evidence.push({
        key: "gsc.clicks",
        label: "Organic clicks",
        value: formatNumber(section.data.metrics.clicks.current ?? 0),
        direction: direction(section.data.metrics.clicks.change),
      });
      evidence.push({
        key: "gsc.impressions",
        label: "Search impressions",
        value: formatNumber(section.data.metrics.impressions.current ?? 0),
        direction: direction(section.data.metrics.impressions.change),
      });
    }
    if (section.key === "ga4") {
      for (const key of ["sessions", "keyEvents"] as const) {
        const metric = section.data.metrics[key];
        if (!metric) continue;
        evidence.push({
          key: `ga4.${key}`,
          label: key === "sessions" ? "Organic sessions" : "Organic key events",
          value: formatNumber(metric.current ?? 0),
          direction: direction(metric.change),
        });
      }
    }
    if (section.key === "google_ads") {
      evidence.push({
        key: "google_ads.conversions",
        label: "Ad conversions",
        value: formatNumber(section.data.metrics.conversions.current ?? 0),
        direction: direction(section.data.metrics.conversions.change),
      });
      evidence.push({
        key: "google_ads.cost_per_conversion",
        label: "Ad cost per conversion",
        value: formatNumber(
          section.data.metrics.costPerConversion.current ?? 0,
        ),
        direction: direction(
          section.data.metrics.costPerConversion.change,
          true,
        ),
      });
    }
    if (section.key === "audit") {
      const critical = section.data.issues
        .filter((issue) => issue.severity === "critical")
        .reduce((sum, issue) => sum + issue.affectedPages, 0);
      evidence.push({
        key: "audit.critical_pages",
        label: "Pages with critical audit issues",
        value: formatNumber(critical),
        direction: critical === 0 ? "positive" : "negative",
      });
    }
    if (section.key === "ai_visibility") {
      const answered = sumBy(section.data.configs, (c) => c.summary.answered);
      const mentioned = sumBy(
        section.data.configs,
        (c) => c.summary.brandMentioned,
      );
      const unavailable = sumBy(
        section.data.configs,
        (c) => c.summary.unavailable,
      );
      // Share of *answered* prompts. Prompts no provider answered are reported
      // beside it, never folded in as if the brand had been absent.
      evidence.push({
        key: "ai_visibility.brand_mentions",
        label: "AI answers mentioning the brand",
        value:
          answered === 0
            ? "No answers returned"
            : `${formatNumber(mentioned)} of ${formatNumber(answered)}${
                unavailable > 0
                  ? ` (${formatNumber(unavailable)} unavailable)`
                  : ""
              }`,
        direction:
          answered === 0 ? "neutral" : mentioned > 0 ? "positive" : "negative",
      });
    }
    if (section.key === "traffic_insights") {
      evidence.push({
        key: "traffic_insights.pages",
        label: "Landing pages with organic traffic",
        value: `${formatNumber(section.data.summary.pageCount)} pages${
          section.data.summary.sessions != null
            ? ` · ${formatNumber(section.data.summary.sessions)} sessions`
            : ""
        }${
          section.data.summary.clicks != null
            ? ` · ${formatNumber(section.data.summary.clicks)} clicks`
            : ""
        }`,
        direction: section.data.summary.pageCount > 0 ? "neutral" : "negative",
      });
    }
    if (section.key === "local_geo_grid") {
      const withRank = section.data.configs.filter(
        (config) => config.summary.averageRank != null,
      );
      const change = section.data.configs.reduce((total, config) => {
        const current = config.summary.topThreeCoverage;
        const previous = config.previous?.topThreeCoverage;
        return current != null && previous != null
          ? total + (current - previous)
          : total;
      }, 0);
      evidence.push({
        key: "local_geo_grid.average_rank",
        label: "Average map pack rank",
        value:
          withRank.length === 0
            ? "Not ranked in the stored grid"
            : formatNumber(
                sumBy(withRank, (config) => config.summary.averageRank ?? 0) /
                  withRank.length,
              ),
        // A lower average map rank is an improvement, so the top-three
        // coverage delta carries the direction instead.
        direction: withRank.length === 0 ? "neutral" : direction(change),
      });
    }
  }
  return evidence.slice(0, 12);
}

export async function assembleReportSnapshot(input: {
  projectId: string;
  periodStart: string;
  periodEnd: string;
  compareStart: string;
  compareEnd: string;
  sections: Array<{ key: ReportSectionKey; enabled: boolean }>;
  generatedAt?: Date;
}): Promise<ReportSnapshot> {
  const project = await getReportProject(input.projectId);
  if (!project) throw new Error("Report project not found");
  const loaded: ReportSnapshot["sections"] = [];
  const omissions: ReportSnapshot["omissions"] = [];
  for (const section of input.sections) {
    if (!section.enabled) {
      omissions.push({ key: section.key, reason: "disabled" });
      continue;
    }
    const result = await loadReportSection(section.key, input.projectId, input);
    if (result.status === "loaded") loaded.push(result.section);
    else omissions.push({ key: section.key, reason: result.reason });
  }
  return reportSnapshotSchema.parse({
    version: 1,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    project,
    period: { start: input.periodStart, end: input.periodEnd },
    comparisonPeriod: { start: input.compareStart, end: input.compareEnd },
    sections: loaded,
    omissions,
    evidence: buildEvidence(loaded),
  });
}
