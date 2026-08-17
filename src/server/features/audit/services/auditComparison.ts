type ComparableAuditIssue = {
  issueType: string;
  severity: "critical" | "warning" | "info";
  pageUrl: string;
};

type AuditIssueDelta = {
  hasBaseline: boolean;
  currentCount: number;
  previousCount: number | null;
  newIssues: ComparableAuditIssue[];
  resolvedIssues: ComparableAuditIssue[];
  bySeverity: Record<
    ComparableAuditIssue["severity"],
    { new: number; resolved: number }
  >;
};

const MAX_SAMPLE_ISSUES = 100;

// An issue's identity is its type on a page. Two audits that both report
// "missing title" on /pricing describe one persistent problem, not two.
function fingerprint(issue: ComparableAuditIssue) {
  return `${issue.issueType} ${issue.pageUrl}`;
}

function countSeverity(
  issues: ComparableAuditIssue[],
  severity: ComparableAuditIssue["severity"],
) {
  return issues.filter((issue) => issue.severity === severity).length;
}

function countBySeverity(
  newIssues: ComparableAuditIssue[],
  resolvedIssues: ComparableAuditIssue[],
): AuditIssueDelta["bySeverity"] {
  return {
    critical: {
      new: countSeverity(newIssues, "critical"),
      resolved: countSeverity(resolvedIssues, "critical"),
    },
    warning: {
      new: countSeverity(newIssues, "warning"),
      resolved: countSeverity(resolvedIssues, "warning"),
    },
    info: {
      new: countSeverity(newIssues, "info"),
      resolved: countSeverity(resolvedIssues, "info"),
    },
  };
}

/** Pure diff between two audits of the same site. The first audit of a project
 * has no baseline, so everything it finds is "current", not "new". */
export function compareAuditIssues(
  current: ComparableAuditIssue[],
  previous: ComparableAuditIssue[] | null,
): AuditIssueDelta {
  if (!previous) {
    return {
      hasBaseline: false,
      currentCount: current.length,
      previousCount: null,
      newIssues: [],
      resolvedIssues: [],
      bySeverity: countBySeverity([], []),
    };
  }
  const currentKeys = new Set(current.map(fingerprint));
  const previousKeys = new Set(previous.map(fingerprint));
  const newIssues = current.filter(
    (issue) => !previousKeys.has(fingerprint(issue)),
  );
  const resolvedIssues = previous.filter(
    (issue) => !currentKeys.has(fingerprint(issue)),
  );
  return {
    hasBaseline: true,
    currentCount: current.length,
    previousCount: previous.length,
    newIssues: newIssues.slice(0, MAX_SAMPLE_ISSUES),
    resolvedIssues: resolvedIssues.slice(0, MAX_SAMPLE_ISSUES),
    bySeverity: countBySeverity(newIssues, resolvedIssues),
  };
}
