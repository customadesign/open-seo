import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getRankCannibalizationReport,
  getRankCompetitorsReport,
  getRankSnippetsReport,
  getRankVisibilityReport,
} from "@/serverFunctions/rank-tracking";
import { formatVisibilityContribution } from "@/shared/rank-tracking-visibility";
import {
  EmptyState,
  formatPosition,
  formatSigned,
  LoadingState,
  ReportTable,
} from "./RankTrackingReportUi";

function formatCheckDate(value: string | null): string | null {
  if (value == null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toLocaleDateString();
}

export function CannibalizationReportPanel({
  projectId,
  configId,
  device,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["rankCannibalization", projectId, configId, device],
    queryFn: () =>
      getRankCannibalizationReport({
        data: { projectId, configId, device },
      }),
  });

  if (isLoading) return <LoadingState />;
  const sameSerp = data?.sameSerp ?? [];
  const urlFlips = data?.urlFlips ?? data?.findings ?? [];
  if (!data || (sameSerp.length === 0 && urlFlips.length === 0)) {
    return (
      <EmptyState>
        {data?.serpDetail === "none"
          ? "No URL-flip cannibalization in stored snapshots. Same-SERP detection starts after the next rank check — older snapshots only stored the best URL."
          : data?.serpDetail === "pruned"
            ? "Same-SERP detail for older checks was pruned. Position history is still complete. Run a new check to refresh SERP URLs."
            : "No same-SERP multi-URL cases and no URL-flip cannibalization in stored checks. A single one-way URL change is not reported."}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Same SERP</h3>
        <p className="text-xs text-base-content/60">
          Two or more of your URLs on one results page. This is the primary
          cannibalization signal.
        </p>
        {sameSerp.length === 0 ? (
          <p className="text-sm text-base-content/60">
            {data.serpDetail === "none"
              ? "No same-SERP data yet — older checks did not store every ranking URL."
              : data.serpDetail === "pruned"
                ? "Same-SERP detail for older checks was pruned."
                : "No keyword has two of your URLs on the latest captured SERP."}
          </p>
        ) : (
          <ReportTable
            headers={["Keyword", "Best", "URLs"]}
            rows={sameSerp.map((row) => [
              row.keyword,
              formatPosition(row.currentPosition),
              row.urls
                .map((url) => `${url.url} (#${url.position})`)
                .join(" · "),
            ])}
          />
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">URL flips over time</h3>
        <p className="text-xs text-base-content/60">
          The best ranking URL changed more than once. A single one-way change
          (redirect or page move) is not reported.
        </p>
        {urlFlips.length === 0 ? (
          <p className="text-sm text-base-content/60">
            No URL-flip signal across {data.scannedKeywords} keywords in{" "}
            {data.runCount} checks.
          </p>
        ) : (
          <ReportTable
            headers={["Keyword", "Position", "URLs", "Flips"]}
            rows={urlFlips.map((row) => [
              row.keyword,
              formatPosition(row.currentPosition),
              row.competingUrls
                .map((url) => `${url.url} (${url.snapshotCount})`)
                .join(" · "),
              row.transitionCount,
            ])}
          />
        )}
      </section>
    </div>
  );
}

export function SnippetsReportPanel({
  projectId,
  configId,
  device,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["rankSnippets", projectId, configId, device],
    queryFn: () =>
      getRankSnippetsReport({ data: { projectId, configId, device } }),
  });

  if (isLoading) return <LoadingState />;
  if (!data || !data.ownershipAvailable) {
    return (
      <EmptyState>
        {data?.serpDetail === "pruned"
          ? "Snippet ownership for older checks was pruned. Position history is still complete. Run a new check to refresh owned, available, and lost snippets."
          : "Snippet ownership was not stored on older checks. Run a rank check to see owned, available, and lost featured snippets — no extra provider cost."}
      </EmptyState>
    );
  }
  if (data.rows.length === 0) {
    const since = formatCheckDate(data.capturedSince);
    return (
      <EmptyState>
        {since
          ? `No notable SERP features in the latest captured check (ownership starts ${since}).`
          : "No notable SERP features in the latest captured check."}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-base-content/60">
        Owned means this domain holds the feature. Available means it is on the
        SERP but another domain holds it. Lost means you held it on the previous
        captured check.
        {formatCheckDate(data.capturedSince)
          ? ` Ownership starts ${formatCheckDate(data.capturedSince)}.`
          : ""}
      </p>
      <ReportTable
        headers={["Keyword", "Feature", "Status", "Position"]}
        rows={data.rows.map((row) => [
          row.keyword,
          row.feature.replaceAll("_", " "),
          row.status,
          formatPosition(row.position),
        ])}
      />
    </div>
  );
}

export function CompetitorsReportPanel({
  projectId,
  configId,
  device,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["rankCompetitors", projectId, configId, device],
    queryFn: () =>
      getRankCompetitorsReport({
        data: { projectId, configId, device },
      }),
  });

  if (isLoading) return <LoadingState />;
  if (!data || !data.available) {
    return (
      <EmptyState>
        {data?.reason === "no_checks"
          ? "No stored rank checks yet."
          : data?.reason === "serp_pruned"
            ? "Competitor domains for older checks were pruned. Position history is still complete. Run a new check to refresh discovery — no extra provider cost."
            : "Not enough history yet. Competitor domains start being stored on the next rank check — no extra provider cost. Older snapshots cannot invent a competitor list."}
      </EmptyState>
    );
  }
  if (data.competitors.length === 0) {
    const since = formatCheckDate(data.capturedSince);
    return (
      <EmptyState>
        {since
          ? `No competitor domains appeared in the latest captured check (data starts ${since}).`
          : "No competitor domains appeared in the latest captured check."}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-base-content/60">
        Domains that appear in organic results for this tracker&apos;s keywords,
        ranked by keyword overlap, how often they appear in recent checks, and
        average position.
        {formatCheckDate(data.capturedSince)
          ? ` No competitor data before ${formatCheckDate(data.capturedSince)}.`
          : ""}
      </p>
      <ReportTable
        headers={["Domain", "Keywords", "Checks", "Avg position"]}
        rows={data.competitors.map((row) => [
          row.domain,
          row.overlapCount,
          row.appearanceCount,
          row.averagePosition.toFixed(1),
        ])}
      />
    </div>
  );
}

export function VisibilityReportPanel({
  projectId,
  configId,
  device,
}: {
  projectId: string;
  configId: string;
  device: "desktop" | "mobile";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["rankVisibility", projectId, configId, device],
    queryFn: () =>
      getRankVisibilityReport({
        data: { projectId, configId, device },
      }),
  });

  const movers = useMemo(
    () =>
      (data?.contributions ?? []).filter(
        (row) => Math.abs(row.contribution) >= 0.01,
      ),
    [data],
  );

  if (isLoading) return <LoadingState />;
  if (!data || movers.length === 0) {
    return (
      <EmptyState>
        Visibility attribution needs search volume and at least two checks.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-sm">
        <span>
          Visibility{" "}
          <strong>
            {data.visibility == null ? "—" : `${data.visibility.toFixed(2)}%`}
          </strong>
        </span>
        <span>
          Change <strong>{formatSigned(data.delta, 2)}</strong>
        </span>
      </div>
      {data.summary.length > 0 ? (
        <p className="text-sm">{data.summary.join(", ")}</p>
      ) : null}
      <ReportTable
        headers={["Keyword", "Now", "Previous", "Contribution"]}
        rows={movers.map((row) => [
          row.keyword,
          formatPosition(row.position),
          formatPosition(row.previousPosition),
          formatVisibilityContribution(row.keyword, row.contribution).replace(
            `${row.keyword} `,
            "",
          ),
        ])}
      />
    </div>
  );
}
