import { AppError } from "@/server/lib/errors";
import { ChangeEventService } from "@/server/features/change-events/services/ChangeEventService";
import { AuditComparisonRepository } from "../repositories/AuditComparisonRepository";
import { AuditRepository } from "../repositories/AuditRepository";

type Severity = "critical" | "warning" | "info";

export type ComparableAuditIssue = {
  issueType: string;
  severity: Severity;
  pageUrl: string;
  detailsJson: string | null;
};

type ComparableAuditSnapshot = {
  audit: {
    id: string;
    startUrl: string;
    startedAt: string;
    completedAt: string | null;
  };
  issues: ComparableAuditIssue[];
  pageUrls: string[];
};

const severityKeys = ["critical", "warning", "info"] as const;
const MAX_DETAIL_ROWS = 100;

function issueFingerprint(issue: ComparableAuditIssue) {
  return [issue.issueType, issue.pageUrl, issue.detailsJson ?? ""].join(
    "\u0000",
  );
}

function zeroSeverityCounts() {
  return {
    critical: { new: 0, resolved: 0, persistent: 0 },
    warning: { new: 0, resolved: 0, persistent: 0 },
    info: { new: 0, resolved: 0, persistent: 0 },
  };
}

export function compareAuditSnapshots(
  current: ComparableAuditSnapshot,
  previous: ComparableAuditSnapshot | null,
) {
  const currentPages = new Set(current.pageUrls);
  if (!previous) {
    return {
      hasBaseline: false as const,
      currentAudit: current.audit,
      previousAudit: null,
      currentIssueCount: current.issues.length,
      previousIssueCount: null,
      newIssueCount: 0,
      resolvedIssueCount: 0,
      persistentIssueCount: 0,
      bySeverity: zeroSeverityCounts(),
      newIssues: [] as ComparableAuditIssue[],
      resolvedIssues: [] as ComparableAuditIssue[],
      issueDetailsTruncated: false,
      pages: {
        current: currentPages.size,
        previous: null,
        added: 0,
        removed: 0,
        addedUrls: [] as string[],
        removedUrls: [] as string[],
        detailsTruncated: false,
      },
    };
  }

  const currentByFingerprint = new Map(
    current.issues.map((issue) => [issueFingerprint(issue), issue]),
  );
  const previousByFingerprint = new Map(
    previous.issues.map((issue) => [issueFingerprint(issue), issue]),
  );
  const newIssues = [...currentByFingerprint]
    .filter(([key]) => !previousByFingerprint.has(key))
    .map(([, issue]) => issue);
  const resolvedIssues = [...previousByFingerprint]
    .filter(([key]) => !currentByFingerprint.has(key))
    .map(([, issue]) => issue);
  const persistentIssues = [...currentByFingerprint]
    .filter(([key]) => previousByFingerprint.has(key))
    .map(([, issue]) => issue);

  const bySeverity = zeroSeverityCounts();
  for (const severity of severityKeys) {
    bySeverity[severity].new = newIssues.filter(
      (issue) => issue.severity === severity,
    ).length;
    bySeverity[severity].resolved = resolvedIssues.filter(
      (issue) => issue.severity === severity,
    ).length;
    bySeverity[severity].persistent = persistentIssues.filter(
      (issue) => issue.severity === severity,
    ).length;
  }

  const previousPages = new Set(previous.pageUrls);
  const addedUrls = [...currentPages].filter((url) => !previousPages.has(url));
  const removedUrls = [...previousPages].filter(
    (url) => !currentPages.has(url),
  );

  return {
    hasBaseline: true as const,
    currentAudit: current.audit,
    previousAudit: previous.audit,
    currentIssueCount: current.issues.length,
    previousIssueCount: previous.issues.length,
    newIssueCount: newIssues.length,
    resolvedIssueCount: resolvedIssues.length,
    persistentIssueCount: persistentIssues.length,
    bySeverity,
    newIssues: newIssues.slice(0, MAX_DETAIL_ROWS),
    resolvedIssues: resolvedIssues.slice(0, MAX_DETAIL_ROWS),
    issueDetailsTruncated:
      newIssues.length > MAX_DETAIL_ROWS ||
      resolvedIssues.length > MAX_DETAIL_ROWS,
    pages: {
      current: currentPages.size,
      previous: previousPages.size,
      added: addedUrls.length,
      removed: removedUrls.length,
      addedUrls: addedUrls.slice(0, MAX_DETAIL_ROWS),
      removedUrls: removedUrls.slice(0, MAX_DETAIL_ROWS),
      detailsTruncated:
        addedUrls.length > MAX_DETAIL_ROWS ||
        removedUrls.length > MAX_DETAIL_ROWS,
    },
  };
}

async function getComparison(auditId: string, projectId: string) {
  const currentAudit = await AuditRepository.getAuditForProject(
    auditId,
    projectId,
  );
  if (!currentAudit) throw new AppError("NOT_FOUND");
  if (currentAudit.status !== "completed") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Audit comparisons are available after the crawl completes.",
    );
  }

  const previousAudit =
    await AuditComparisonRepository.getPreviousCompletedAudit({
      projectId,
      startUrl: currentAudit.startUrl,
      beforeStartedAt: currentAudit.startedAt,
    });
  const [currentIssues, currentPages, previousIssues, previousPages] =
    await Promise.all([
      AuditRepository.getIssuesForAudit(currentAudit.id, {}),
      AuditRepository.getPagesForAudit(currentAudit.id),
      previousAudit
        ? AuditRepository.getIssuesForAudit(previousAudit.id, {})
        : Promise.resolve([]),
      previousAudit
        ? AuditRepository.getPagesForAudit(previousAudit.id)
        : Promise.resolve([]),
    ]);

  return compareAuditSnapshots(
    {
      audit: currentAudit,
      issues: currentIssues,
      pageUrls: currentPages.map((page) => page.url),
    },
    previousAudit
      ? {
          audit: previousAudit,
          issues: previousIssues,
          pageUrls: previousPages.map((page) => page.url),
        }
      : null,
  );
}

async function recordChangeEvents(auditId: string, projectId: string) {
  const comparison = await getComparison(auditId, projectId);
  if (!comparison.hasBaseline) return { recorded: 0 };

  const occurredAt =
    comparison.currentAudit.completedAt ?? comparison.currentAudit.startedAt;
  const events: Parameters<typeof ChangeEventService.record>[0][] = [];
  if (comparison.newIssueCount > 0) {
    const severity =
      comparison.bySeverity.critical.new > 0
        ? ("critical" as const)
        : comparison.bySeverity.warning.new > 0
          ? ("warning" as const)
          : ("info" as const);
    events.push({
      projectId,
      source: "audit",
      eventType: "audit.regression",
      severity,
      title: `${comparison.newIssueCount} new site audit ${comparison.newIssueCount === 1 ? "issue" : "issues"}`,
      summary: `Compared with the previous crawl: ${comparison.newIssueCount} new, ${comparison.resolvedIssueCount} resolved, and ${comparison.persistentIssueCount} unchanged.`,
      entityType: "audit",
      entityId: auditId,
      sourceRunId: auditId,
      dedupeKey: `audit:${auditId}:regression`,
      metricKey: "issue_count",
      previousNumericValue: comparison.previousIssueCount,
      currentNumericValue: comparison.currentIssueCount,
      unit: "issues",
      occurredAt,
    });
  }
  if (comparison.resolvedIssueCount > 0) {
    events.push({
      projectId,
      source: "audit",
      eventType: "audit.improvement",
      severity: "opportunity",
      title: `${comparison.resolvedIssueCount} site audit ${comparison.resolvedIssueCount === 1 ? "issue was" : "issues were"} resolved`,
      summary: `The latest crawl no longer found ${comparison.resolvedIssueCount} previous ${comparison.resolvedIssueCount === 1 ? "issue" : "issues"}; ${comparison.newIssueCount} new ${comparison.newIssueCount === 1 ? "issue was" : "issues were"} also detected.`,
      entityType: "audit",
      entityId: auditId,
      sourceRunId: auditId,
      dedupeKey: `audit:${auditId}:improvement`,
      metricKey: "resolved_issue_count",
      previousNumericValue: 0,
      currentNumericValue: comparison.resolvedIssueCount,
      unit: "issues",
      occurredAt,
    });
  }

  await Promise.all(events.map((event) => ChangeEventService.record(event)));
  return { recorded: events.length };
}

export const AuditComparisonService = {
  getComparison,
  recordChangeEvents,
} as const;
