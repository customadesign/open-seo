import { describe, expect, it } from "vitest";
import {
  estimateGeoGridRunCost,
  estimateScheduledGeoGridCost,
  hasPaidMapsSearchOperator,
} from "./local-seo";

describe("geo-grid cost estimates", () => {
  it("mirrors per-cell hosted credit rounding", () => {
    expect(estimateGeoGridRunCost(5, true)).toEqual({
      cells: 25,
      costUsd: 0.075,
      costCredits: 75,
    });
  });

  it("shows the recurring monthly estimate", () => {
    expect(estimateScheduledGeoGridCost(5, "weekly", true)).toEqual({
      cells: 25,
      costUsd: 0.075,
      costCredits: 75,
      scheduleInterval: "weekly",
      checksPerMonth: 52 / 12,
      monthlyCostUsd: 0.325,
      monthlyCostCredits: 325,
    });
  });

  it.each([
    "site:example.com sign shop",
    "sign shop -site:example.com",
    "sign shop,site:example.com",
    '"site:example.com" sign shop',
    "sign_shop_site:example.com",
    "sign shopsite:example.com",
    "ALLINTITLE:sign shop",
    "filetype:pdf sign shop",
  ])("detects paid Maps search operators in %s", (keyword) => {
    expect(hasPaidMapsSearchOperator(keyword)).toBe(true);
  });

  it("does not mistake ordinary punctuation for a paid operator", () => {
    expect(hasPaidMapsSearchOperator("sign shop: Escondido")).toBe(false);
  });

  it("shows raw provider cost for self-hosted deployments", () => {
    expect(estimateGeoGridRunCost(5, false)).toEqual({
      cells: 25,
      costUsd: 0.05,
      costCredits: 50,
    });
  });
});
