import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowRight, ArrowUp, History } from "lucide-react";
import type { ReactNode } from "react";
import { getAuditComparison } from "@/serverFunctions/audit";
import { AUDIT_ISSUE_TYPES } from "@/shared/audit-issues";

const issueTitles: Record<string, string | undefined> = Object.fromEntries(
  Object.entries(AUDIT_ISSUE_TYPES).map(([key, value]) => [key, value.title]),
);

export function AuditComparisonPanel({
  projectId,
  auditId,
}: {
  projectId: string;
  auditId: string;
}) {
  const comparison = useQuery({
    queryKey: ["audit-comparison", projectId, auditId],
    queryFn: () => getAuditComparison({ data: { projectId, auditId } }),
  });

  if (comparison.isPending) {
    return <div className="skeleton h-28" aria-busy />;
  }
  if (comparison.isError) return null;
  if (!comparison.data.hasBaseline) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-base-300 bg-base-100 p-4 text-sm">
        <History className="mt-0.5 size-4 shrink-0 text-base-content/50" />
        <div>
          <p className="font-medium">This is the comparison baseline</p>
          <p className="mt-0.5 text-base-content/60">
            Run the same site audit again to see what is new, fixed, or still
            present.
          </p>
        </div>
      </div>
    );
  }

  const data = comparison.data;
  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Changes since the previous crawl</h2>
          <p className="mt-1 text-xs text-base-content/55">
            Compared with {formatComparisonDate(data.previousAudit.startedAt)}
          </p>
        </div>
        <span className="badge badge-outline">
          {data.currentIssueCount - data.previousIssueCount > 0 ? "+" : ""}
          {data.currentIssueCount - data.previousIssueCount} net issues
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <ComparisonStat
          label="New"
          value={data.newIssueCount}
          icon={<ArrowUp className="size-4 text-error" />}
        />
        <ComparisonStat
          label="Resolved"
          value={data.resolvedIssueCount}
          icon={<ArrowDown className="size-4 text-success" />}
        />
        <ComparisonStat
          label="Unchanged"
          value={data.persistentIssueCount}
          icon={<ArrowRight className="size-4 text-base-content/40" />}
        />
        <ComparisonStat
          label="Pages"
          value={data.pages.current}
          detail={`${data.pages.added} added · ${data.pages.removed} removed`}
        />
      </div>

      {(data.newIssues.length > 0 || data.resolvedIssues.length > 0) && (
        <details className="mt-4 rounded-lg bg-base-200/60 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">
            Review changed issues
          </summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <IssueChangeList title="New" issues={data.newIssues} />
            <IssueChangeList title="Resolved" issues={data.resolvedIssues} />
          </div>
          {data.issueDetailsTruncated ? (
            <p className="mt-3 text-xs text-base-content/55">
              Showing the first 100 changed issues in each group.
            </p>
          ) : null}
        </details>
      )}
    </section>
  );
}

function ComparisonStat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: number;
  detail?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-base-200/70 p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-base-content/60">
        <span>{label}</span>
        {icon}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {detail ? (
        <p className="mt-0.5 text-xs text-base-content/50">{detail}</p>
      ) : null}
    </div>
  );
}

function IssueChangeList({
  title,
  issues,
}: {
  title: string;
  issues: Array<{ issueType: string; pageUrl: string }>;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
        {title} ({issues.length})
      </h3>
      {issues.length === 0 ? (
        <p className="mt-2 text-sm text-base-content/50">None</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {issues.map((issue, index) => (
            <li
              key={`${issue.issueType}:${issue.pageUrl}:${index}`}
              className="min-w-0 text-sm"
            >
              <p className="font-medium">
                {issueTitles[issue.issueType] ?? issue.issueType}
              </p>
              <p
                className="truncate text-xs text-base-content/50"
                title={issue.pageUrl}
              >
                {issue.pageUrl}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatComparisonDate(value: string) {
  const date = new Date(
    value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
  );
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
