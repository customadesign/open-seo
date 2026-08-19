import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  exportIssues,
  exportPages,
  exportPerformance,
} from "@/client/features/audit/results/export";
import type { AuditResultsData } from "@/client/features/audit/results/types";
import { isLighthouseFailure } from "@/client/features/audit/results/AuditResultsTableFilterLogic";
import { IssuesView } from "@/client/features/audit/results/IssuesView";
import { PagesTable } from "@/client/features/audit/results/PagesTable";
import { AuditSummaryStrip } from "@/client/features/audit/results/AuditSummaryStrip";
import {
  AuditIssuesSummaryModal,
  LighthouseFailuresModal,
} from "@/client/features/audit/results/AuditSummaryModals";
import {
  ExportDropdown,
  PerformanceTable,
} from "@/client/features/audit/results/ResultsTables";

type ResultsTab = "issues" | "pages" | "performance";

export function ResultsView({
  projectId,
  data,
  onTabChange,
  tab,
}: {
  projectId: string;
  data: AuditResultsData;
  tab: string;
  onTabChange: (tab: ResultsTab) => void;
}) {
  const { audit, pages, lighthouse, issues } = data;
  const [summaryModal, setSummaryModal] = useState<
    "issues" | "lighthouse-failures" | null
  >(null);
  const [failureFocusToken, setFailureFocusToken] = useState(0);
  const hasPerformanceTab = lighthouse.length > 0;
  const activeTab =
    tab === "performance" && !hasPerformanceTab ? "issues" : tab;
  const stats = useResultStats(pages, lighthouse);
  const blockedCount = useMemo(
    () => pages.filter((page) => page.fetchClass === "blocked").length,
    [pages],
  );

  return (
    <>
      {blockedCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <span className="font-medium">
              We were blocked on {blockedCount}{" "}
              {blockedCount === 1 ? "page" : "pages"}.
            </span>{" "}
            <span className="text-base-content/70">
              The site's bot protection challenged our crawler, so those pages
              couldn't be audited. If this is your site, allowlist the{" "}
              <code className="font-mono">OpenSEO-Audit</code> user agent in
              your WAF or bot-protection settings and re-run the audit.
            </span>
          </p>
        </div>
      )}

      <AuditSummaryStrip
        pagesCrawled={audit.pagesCrawled}
        issues={issues}
        totalLighthouse={lighthouse.length}
        averageResponseMs={stats.averageResponseMs}
        lighthouseSummary={stats.lighthouseSummary}
        onShowIssues={() => setSummaryModal("issues")}
        onShowLighthouseFailures={() => setSummaryModal("lighthouse-failures")}
      />

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body gap-3">
          <ResultsHeader
            issueCount={issues.length}
            pageCount={pages.length}
            lighthouseCount={lighthouse.length}
            hasPerformanceTab={hasPerformanceTab}
            activeTab={activeTab}
            onTabChange={onTabChange}
            onExport={(format) => {
              if (activeTab === "performance") {
                exportPerformance(lighthouse, pages, format);
                return;
              }
              if (activeTab === "issues") {
                exportIssues(issues, format);
                return;
              }
              exportPages(pages, format);
            }}
          />

          {activeTab === "issues" && <IssuesView issues={issues} />}
          {activeTab === "pages" && (
            <PagesTable
              pages={pages}
              startUrl={audit.startUrl}
              issues={issues}
            />
          )}
          {activeTab === "performance" && lighthouse.length > 0 && (
            <PerformanceTable
              auditId={audit.id}
              projectId={projectId}
              lighthouse={lighthouse}
              pages={pages}
              failureFocusToken={failureFocusToken}
            />
          )}
        </div>
      </div>

      {summaryModal === "issues" ? (
        <AuditIssuesSummaryModal
          issues={issues}
          onClose={() => setSummaryModal(null)}
          onOpenReport={() => {
            setSummaryModal(null);
            onTabChange("issues");
          }}
        />
      ) : null}

      {summaryModal === "lighthouse-failures" ? (
        <LighthouseFailuresModal
          lighthouse={lighthouse}
          pages={pages}
          onClose={() => setSummaryModal(null)}
          onOpenPerformance={() => {
            setSummaryModal(null);
            setFailureFocusToken((token) => token + 1);
            onTabChange("performance");
          }}
        />
      ) : null}
    </>
  );
}

function useResultStats(
  pages: AuditResultsData["pages"],
  lighthouse: AuditResultsData["lighthouse"],
) {
  const averageResponseMs = useMemo(() => {
    if (pages.length === 0) return 0;
    const total = pages.reduce(
      (sum: number, page: AuditResultsData["pages"][number]) =>
        sum + (page.responseTimeMs ?? 0),
      0,
    );
    return Math.round(total / pages.length);
  }, [pages]);

  const lighthouseSummary = useMemo(() => {
    const failed = lighthouse.filter(
      (row: AuditResultsData["lighthouse"][number]) => isLighthouseFailure(row),
    ).length;
    const successful = lighthouse.filter(
      (row: AuditResultsData["lighthouse"][number]) =>
        !isLighthouseFailure(row),
    );
    const averageScore = (
      key: "performanceScore" | "seoScore" | "accessibilityScore",
    ) => {
      const values = successful
        .map((row: AuditResultsData["lighthouse"][number]) => row[key])
        .filter((value: number | null): value is number => value != null);
      if (values.length === 0) return null;
      const total = values.reduce((sum: number, value) => sum + value, 0);
      return Math.round(total / values.length);
    };

    return {
      failed,
      avgPerformance: averageScore("performanceScore"),
      avgSeo: averageScore("seoScore"),
      avgAccessibility: averageScore("accessibilityScore"),
    };
  }, [lighthouse]);

  return { averageResponseMs, lighthouseSummary };
}

function ResultsHeader({
  issueCount,
  pageCount,
  lighthouseCount,
  hasPerformanceTab,
  activeTab,
  onTabChange,
  onExport,
}: {
  issueCount: number;
  pageCount: number;
  lighthouseCount: number;
  hasPerformanceTab: boolean;
  activeTab: string;
  onTabChange: (tab: ResultsTab) => void;
  onExport: (format: "csv" | "json" | "sheets") => void;
}) {
  const tabs: Array<{ tab: ResultsTab; label: string }> = [
    { tab: "issues", label: `Issues (${issueCount})` },
    { tab: "pages", label: `Pages (${pageCount})` },
    ...(hasPerformanceTab
      ? [
          {
            tab: "performance" as const,
            label: `Performance (${lighthouseCount})`,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
      <div role="tablist" className="tabs tabs-border w-fit">
        {tabs.map(({ label, tab }) => {
          const isActive = activeTab === tab;

          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`tab ${isActive ? "tab-active" : ""}`}
              onClick={() => onTabChange(tab)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <ExportDropdown onExport={onExport} />
    </div>
  );
}
