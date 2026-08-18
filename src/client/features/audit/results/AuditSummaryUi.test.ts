import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LighthouseFailuresModal } from "./AuditSummaryModals";
import { AuditSummaryStat } from "./AuditSummaryStrip";

describe("AuditSummaryStat", () => {
  it("renders actionable summary values as labelled buttons", () => {
    const markup = renderToStaticMarkup(
      createElement(AuditSummaryStat, {
        item: {
          label: "Issues found",
          value: "8",
          onClick: vi.fn(),
        },
      }),
    );

    expect(markup).toContain("<button");
    expect(markup).toContain("View details for Issues found: 8");
    expect(markup).toContain("View details");
  });

  it("keeps zero-value summaries static", () => {
    const markup = renderToStaticMarkup(
      createElement(AuditSummaryStat, {
        item: { label: "Lighthouse failures", value: "0" },
      }),
    );

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("View details");
  });
});

describe("LighthouseFailuresModal", () => {
  it("shows the cause, fix, affected tests, and technical detail", () => {
    const errorMessage =
      "DataForSEO HTTP 402 on /v3/on_page/lighthouse/live/json";
    const lighthouse = [
      {
        id: "mobile",
        pageId: "page-1",
        strategy: "mobile" as const,
        errorMessage,
        performanceScore: null,
        accessibilityScore: null,
        bestPracticesScore: null,
        seoScore: null,
      },
      {
        id: "desktop",
        pageId: "page-1",
        strategy: "desktop" as const,
        errorMessage,
        performanceScore: null,
        accessibilityScore: null,
        bestPracticesScore: null,
        seoScore: null,
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(LighthouseFailuresModal, {
        lighthouse,
        pages: [{ id: "page-1", url: "https://example.com/category/" }],
        onClose: vi.fn(),
        onOpenPerformance: vi.fn(),
      }),
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("2 Lighthouse failures");
    expect(markup).toContain("DataForSEO billing blocked Lighthouse");
    expect(markup).toContain("Add credit or resolve the billing issue");
    expect(markup).toContain("https://example.com/category/");
    expect(markup).toContain("mobile");
    expect(markup).toContain("desktop");
    expect(markup).toContain("Technical detail");
    expect(markup).toContain("Show failed tests in table");
  });
});
