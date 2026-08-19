import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  OpportunityActionCell,
  OpportunityPageCell,
} from "@/client/features/search-performance/SearchOpportunityColumns";
import type { SearchOpportunityRow } from "@/client/features/search-performance/searchOpportunityUi";

const row: SearchOpportunityRow = {
  page: "https://example.com/widgets",
  normalizedPage: "example.com/widgets",
  clicks: 20,
  impressions: 1_000,
  ctr: 0.02,
  position: 6,
  joinStatus: "joined",
  ga4: {
    sessions: 100,
    activeUsers: 90,
    engagedSessions: 80,
    engagementRate: 0.8,
    keyEvents: 5,
    sessionKeyEventRate: 0.05,
    transactions: 0,
    purchaseRevenue: null,
  },
  score: 70,
  scoreComponents: { demand: 0.9, businessValue: 0.5, reachability: 0.25 },
  topQueries: [
    { query: "widget repair", clicks: 5, impressions: 400, position: 6 },
  ],
};

describe("OpportunityPageCell", () => {
  it("shows the page, the queries it ranks for, and why it scored", () => {
    const markup = renderToStaticMarkup(
      createElement(OpportunityPageCell, {
        row,
        businessValueMetric: "sessionKeyEventRate",
      }),
    );
    expect(markup).toContain('href="https://example.com/widgets"');
    expect(markup).toContain("widget repair");
    expect(markup).toContain("Business value 50% — key-event rate");
  });

  it("renders a non-URL page key as text rather than a link", () => {
    const markup = renderToStaticMarkup(
      createElement(OpportunityPageCell, {
        row: { ...row, page: "javascript:alert(1)" },
        businessValueMetric: "engagementRate",
      }),
    );
    expect(markup).not.toContain("href");
  });
});

describe("OpportunityActionCell", () => {
  it("renders the next action label and its reasoning", () => {
    const markup = renderToStaticMarkup(
      createElement(OpportunityActionCell, {
        row: { ...row, ga4: null, score: null, scoreComponents: null },
      }),
    );
    expect(markup).toContain("Confirm analytics coverage");
    expect(markup).toContain("no GA4 organic landing page matched it");
  });
});
