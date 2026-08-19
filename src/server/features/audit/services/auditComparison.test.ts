import { describe, expect, it } from "vitest";
import { compareAuditIssues } from "./auditComparison";

const issue = (
  issueType: string,
  pageUrl: string,
  severity: "critical" | "warning" | "info" = "critical",
) => ({ issueType, severity, pageUrl });

describe("compareAuditIssues", () => {
  it("splits new from resolved issues by type and page", () => {
    const delta = compareAuditIssues(
      [
        issue("missing_title", "/pricing"),
        issue("slow_page", "/blog", "warning"),
      ],
      [issue("missing_title", "/pricing"), issue("broken_link", "/about")],
    );

    expect(delta.newIssues).toEqual([issue("slow_page", "/blog", "warning")]);
    expect(delta.resolvedIssues).toEqual([issue("broken_link", "/about")]);
    expect(delta.bySeverity.warning.new).toBe(1);
    expect(delta.bySeverity.critical.resolved).toBe(1);
  });

  it("treats a first audit as a baseline rather than a regression", () => {
    const delta = compareAuditIssues(
      [issue("missing_title", "/pricing")],
      null,
    );
    expect(delta).toMatchObject({
      hasBaseline: false,
      currentCount: 1,
      previousCount: null,
      newIssues: [],
    });
  });
});
