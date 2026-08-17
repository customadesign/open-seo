import { describe, expect, it } from "vitest";
import {
  filterOpportunityRows,
  opportunityNextAction,
  opportunityScoreReasons,
  type SearchOpportunityRow,
} from "@/client/features/search-performance/searchOpportunityUi";

const baseGa4 = {
  sessions: 100,
  activeUsers: 90,
  engagedSessions: 80,
  engagementRate: 0.8,
  keyEvents: 5,
  sessionKeyEventRate: 0.05,
  transactions: 0,
  purchaseRevenue: null,
};

function makeRow(
  overrides: Partial<SearchOpportunityRow> = {},
): SearchOpportunityRow {
  return {
    page: "https://example.com/widgets",
    normalizedPage: "example.com/widgets",
    clicks: 20,
    impressions: 1_000,
    ctr: 0.02,
    position: 6,
    joinStatus: "joined",
    ga4: baseGa4,
    score: 70,
    scoreComponents: { demand: 0.9, businessValue: 0.5, reachability: 0.25 },
    topQueries: [
      { query: "widget repair", clicks: 5, impressions: 400, position: 6 },
    ],
    ...overrides,
  };
}

describe("opportunityNextAction", () => {
  it("asks for analytics coverage before anything else when GA4 never saw the page", () => {
    const action = opportunityNextAction(
      makeRow({
        joinStatus: "gsc_only",
        ga4: null,
        score: null,
        scoreComponents: null,
        position: 18,
        ctr: 0.001,
      }),
    );
    expect(action.label).toBe("Confirm analytics coverage");
  });

  it("fixes a page visitors abandon before promoting it further", () => {
    const action = opportunityNextAction(
      makeRow({
        position: 18,
        ga4: { ...baseGa4, engagementRate: 0.2 },
      }),
    );
    expect(action.label).toBe("Fix the landing page experience");
    expect(action.detail).toContain("20%");
  });

  it("treats a page below the first results as a content and linking problem", () => {
    expect(opportunityNextAction(makeRow({ position: 14 })).label).toBe(
      "Strengthen the page and its internal links",
    );
  });

  it("treats a page-one page nobody clicks as a snippet problem", () => {
    expect(
      opportunityNextAction(makeRow({ position: 6, ctr: 0.005 })).label,
    ).toBe("Rewrite the title and meta description");
  });

  it("suggests widening a page that already ranks, converts, and earns clicks", () => {
    expect(opportunityNextAction(makeRow()).label).toBe(
      "Expand the page for the queries it already ranks for",
    );
  });
});

describe("opportunityScoreReasons", () => {
  it("reports the service's own components with the metric it scored on", () => {
    expect(opportunityScoreReasons(makeRow(), "sessionKeyEventRate")).toEqual([
      "Demand 90% — impressions against the other matched pages",
      "Business value 50% — key-event rate",
      "Reachability 25% — average position 6.0",
    ]);
  });

  it("explains why an unmatched page has no score", () => {
    const reasons = opportunityScoreReasons(
      makeRow({ score: null, scoreComponents: null, ga4: null }),
      "engagementRate",
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("no GA4 organic landing page matched");
  });
});

describe("filterOpportunityRows", () => {
  const joined = makeRow();
  const unmatched = makeRow({
    page: "https://example.com/gadgets",
    joinStatus: "gsc_only",
    ga4: null,
    score: null,
    scoreComponents: null,
    topQueries: [
      { query: "gadget hire", clicks: 1, impressions: 9, position: 9 },
    ],
  });
  const rows = [joined, unmatched];

  it("splits rows by whether GA4 matched them", () => {
    expect(
      filterOpportunityRows(rows, { match: "matched", search: "" }),
    ).toEqual([joined]);
    expect(
      filterOpportunityRows(rows, { match: "unmatched", search: "" }),
    ).toEqual([unmatched]);
  });

  it("searches the page URL and the queries it ranks for", () => {
    expect(
      filterOpportunityRows(rows, { match: "all", search: "GADGET" }),
    ).toEqual([unmatched]);
    expect(
      filterOpportunityRows(rows, { match: "all", search: "widget repair" }),
    ).toEqual([joined]);
  });
});
