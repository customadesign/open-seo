import { describe, expect, it } from "vitest";
import { toChangesSectionResult } from "./ChangesReportSection";

const event = (
  overrides: {
    occurredAt?: string;
    source?: string;
    eventType?: string;
    severity?: string;
    title?: string;
    summary?: string;
  } = {},
) => ({
  occurredAt: overrides.occurredAt ?? "2026-08-12T00:00:00.000Z",
  source: overrides.source ?? "audit",
  eventType: overrides.eventType ?? "audit.regression",
  severity: overrides.severity ?? "warning",
  title: overrides.title ?? "New issues",
  summary: overrides.summary ?? "Two pages gained missing titles.",
  entityType: "audit",
  entityId: "audit-1",
  metricKey: "issue_count",
  previousNumericValue: 1,
  currentNumericValue: 2,
  unit: "issues",
});

describe("toChangesSectionResult", () => {
  it("returns no_data when the period has no events", () => {
    expect(toChangesSectionResult([], [])).toEqual({ status: "no_data" });
  });

  it("includes severity and source totals plus useful event details", () => {
    const result = toChangesSectionResult(
      [
        event({
          title: "Ranks dropped",
          source: "rank_tracking",
          severity: "critical",
        }),
        event({ title: "New issues", source: "audit", severity: "warning" }),
      ],
      [
        { source: "rank_tracking", severity: "critical", total: 1 },
        { source: "audit", severity: "warning", total: 4 },
      ],
    );

    expect(result).toEqual({
      status: "available",
      data: {
        total: 5,
        shown: 2,
        omitted: 3,
        bySeverity: [
          { severity: "critical", count: 1 },
          { severity: "warning", count: 4 },
        ],
        bySource: [
          { source: "audit", count: 4 },
          { source: "rank_tracking", count: 1 },
        ],
        events: [
          expect.objectContaining({
            title: "Ranks dropped",
            source: "rank_tracking",
            severity: "critical",
            metricKey: "issue_count",
            previousNumericValue: 1,
            currentNumericValue: 2,
          }),
          expect.objectContaining({
            title: "New issues",
            source: "audit",
            severity: "warning",
          }),
        ],
      },
    });
  });
});
