import { useMemo, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { AuditResultsData } from "@/client/features/audit/results/types";
import { resolveIssueSeverity } from "@/client/features/audit/results/IssuesView";

interface LighthouseSummaryStats {
  failed: number;
  avgPerformance: number | null;
  avgSeo: number | null;
  avgAccessibility: number | null;
}

interface AuditSummaryStatItem {
  label: string;
  value: string;
  valueClass?: string;
  sub?: ReactNode;
  onClick?: () => void;
}

export function AuditSummaryStrip({
  pagesCrawled,
  issues,
  totalLighthouse,
  averageResponseMs,
  lighthouseSummary,
  onShowIssues,
  onShowLighthouseFailures,
}: {
  pagesCrawled: number;
  issues: AuditResultsData["issues"];
  totalLighthouse: number;
  averageResponseMs: number;
  lighthouseSummary: LighthouseSummaryStats;
  onShowIssues: () => void;
  onShowLighthouseFailures: () => void;
}) {
  const severityCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const issue of issues) {
      counts[resolveIssueSeverity(issue)] += 1;
    }
    return counts;
  }, [issues]);

  const items: AuditSummaryStatItem[] = [
    { label: "Pages crawled", value: String(pagesCrawled) },
    {
      label: "Issues found",
      value: String(issues.length),
      valueClass: issues.length === 0 ? "text-success" : "",
      onClick: issues.length > 0 ? onShowIssues : undefined,
      sub: issues.length > 0 && (
        <span className="flex items-center gap-2.5">
          <SeverityCount count={severityCounts.critical} dotClass="bg-error" />
          <SeverityCount count={severityCounts.warning} dotClass="bg-warning" />
          <SeverityCount
            count={severityCounts.info}
            dotClass="bg-base-content/30"
          />
        </span>
      ),
    },
    { label: "Avg response", value: `${averageResponseMs}ms` },
  ];

  if (totalLighthouse > 0) {
    items.push(
      { label: "Lighthouse tests", value: String(totalLighthouse) },
      {
        label: "Avg Lighthouse perf",
        value:
          lighthouseSummary.avgPerformance == null
            ? "-"
            : String(lighthouseSummary.avgPerformance),
        valueClass: scoreClass(lighthouseSummary.avgPerformance),
      },
      {
        label: "Avg Lighthouse SEO",
        value:
          lighthouseSummary.avgSeo == null
            ? "-"
            : String(lighthouseSummary.avgSeo),
        valueClass: scoreClass(lighthouseSummary.avgSeo),
      },
      {
        label: "Avg Lighthouse a11y",
        value:
          lighthouseSummary.avgAccessibility == null
            ? "-"
            : String(lighthouseSummary.avgAccessibility),
        valueClass: scoreClass(lighthouseSummary.avgAccessibility),
      },
      {
        label: "Lighthouse failures",
        value: String(lighthouseSummary.failed),
        valueClass:
          lighthouseSummary.failed > 0 ? "text-error" : "text-success",
        onClick:
          lighthouseSummary.failed > 0 ? onShowLighthouseFailures : undefined,
      },
    );
  }

  const columnsClass =
    items.length === 3
      ? "grid-cols-1 sm:grid-cols-3"
      : "grid-cols-2 md:grid-cols-4";

  return (
    <div
      className={`grid ${columnsClass} gap-px rounded-lg border border-base-300 bg-base-300/70 overflow-hidden`}
    >
      {items.map((item) => (
        <AuditSummaryStat key={item.label} item={item} />
      ))}
    </div>
  );
}

export function AuditSummaryStat({ item }: { item: AuditSummaryStatItem }) {
  const content = (
    <>
      <p className="text-[11px] uppercase tracking-wider text-base-content/50">
        {item.label}
      </p>
      <p
        className={`mt-0.5 text-xl font-semibold tabular-nums ${item.valueClass ?? ""}`}
      >
        {item.value}
      </p>
      {item.sub || item.onClick ? (
        <div className="mt-1 flex min-h-4 items-center justify-between gap-2 text-xs text-base-content/60">
          <span>{item.sub}</span>
          {item.onClick ? (
            <span className="flex items-center gap-0.5 text-primary">
              View details
              <ChevronRight className="size-3" />
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (!item.onClick) {
    return <div className="bg-base-100 px-4 py-3">{content}</div>;
  }

  return (
    <button
      type="button"
      className="group bg-base-100 px-4 py-3 text-left transition-colors hover:bg-base-200/60 focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
      aria-label={`View details for ${item.label}: ${item.value}`}
      onClick={item.onClick}
    >
      {content}
    </button>
  );
}

function SeverityCount({
  count,
  dotClass,
}: {
  count: number;
  dotClass: string;
}) {
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-1 tabular-nums">
      <span className={`size-1.5 rounded-full ${dotClass}`} />
      {count}
    </span>
  );
}

function scoreClass(score: number | null) {
  if (score == null) return "";
  if (score >= 90) return "text-success";
  if (score >= 50) return "text-warning";
  return "text-error";
}
