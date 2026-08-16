import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: {} }));

import {
  compareAuditSnapshots,
  type ComparableAuditIssue,
} from "./AuditComparisonService";

const audit = (id: string, startedAt: string) => ({
  id,
  startUrl: "https://example.com/",
  startedAt,
  completedAt: startedAt,
});

const issue = (
  issueType: string,
  severity: ComparableAuditIssue["severity"],
  pageUrl: string,
  detailsJson: string | null = null,
): ComparableAuditIssue => ({ issueType, severity, pageUrl, detailsJson });

describe("compareAuditSnapshots", () => {
  it("treats the first completed crawl as a baseline, not as all-new issues", () => {
    const result = compareAuditSnapshots(
      {
        audit: audit("current", "2026-08-17T00:00:00.000Z"),
        issues: [issue("missing-title", "critical", "https://example.com/")],
        pageUrls: ["https://example.com/"],
      },
      null,
    );

    expect(result).toMatchObject({
      hasBaseline: false,
      currentIssueCount: 1,
      previousIssueCount: null,
      newIssueCount: 0,
      resolvedIssueCount: 0,
    });
  });

  it("separates new, resolved, and persistent issues and page changes", () => {
    const persistent = issue(
      "missing-title",
      "critical",
      "https://example.com/",
    );
    const result = compareAuditSnapshots(
      {
        audit: audit("current", "2026-08-17T00:00:00.000Z"),
        issues: [
          persistent,
          issue("thin-content", "warning", "https://example.com/new"),
        ],
        pageUrls: ["https://example.com/", "https://example.com/new"],
      },
      {
        audit: audit("previous", "2026-08-10T00:00:00.000Z"),
        issues: [
          persistent,
          issue("broken-link", "critical", "https://example.com/old", "{}"),
        ],
        pageUrls: ["https://example.com/", "https://example.com/old"],
      },
    );

    expect(result).toMatchObject({
      hasBaseline: true,
      currentIssueCount: 2,
      previousIssueCount: 2,
      newIssueCount: 1,
      resolvedIssueCount: 1,
      persistentIssueCount: 1,
      bySeverity: {
        critical: { new: 0, resolved: 1, persistent: 1 },
        warning: { new: 1, resolved: 0, persistent: 0 },
      },
      pages: {
        current: 2,
        previous: 2,
        added: 1,
        removed: 1,
        addedUrls: ["https://example.com/new"],
        removedUrls: ["https://example.com/old"],
      },
    });
  });

  it("uses details to distinguish multiple findings of one type on one page", () => {
    const result = compareAuditSnapshots(
      {
        audit: audit("current", "2026-08-17T00:00:00.000Z"),
        issues: [
          issue(
            "broken-link",
            "critical",
            "https://example.com/",
            '{"target":"a"}',
          ),
          issue(
            "broken-link",
            "critical",
            "https://example.com/",
            '{"target":"b"}',
          ),
        ],
        pageUrls: ["https://example.com/"],
      },
      {
        audit: audit("previous", "2026-08-10T00:00:00.000Z"),
        issues: [
          issue(
            "broken-link",
            "critical",
            "https://example.com/",
            '{"target":"a"}',
          ),
        ],
        pageUrls: ["https://example.com/"],
      },
    );

    expect(result).toMatchObject({
      newIssueCount: 1,
      resolvedIssueCount: 0,
      persistentIssueCount: 1,
    });
  });
});
