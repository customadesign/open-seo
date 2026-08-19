import { describe, expect, it } from "vitest";
import {
  classifyPositionChange,
  mapKeywordItem,
  normalizeSearchIntent,
} from "@/server/features/domain/services/domainKeywordMapper";

describe("classifyPositionChange", () => {
  it("prefers lost, then new, then direction", () => {
    expect(
      classifyPositionChange({
        isLost: true,
        isNew: true,
        isUp: true,
        isDown: false,
      }),
    ).toBe("lost");
    expect(
      classifyPositionChange({
        isLost: false,
        isNew: true,
        isUp: false,
        isDown: false,
      }),
    ).toBe("new");
    expect(
      classifyPositionChange({
        isLost: false,
        isNew: false,
        isUp: true,
        isDown: false,
      }),
    ).toBe("improved");
    expect(
      classifyPositionChange({
        isLost: false,
        isNew: false,
        isUp: false,
        isDown: true,
      }),
    ).toBe("declined");
    expect(
      classifyPositionChange({
        isLost: false,
        isNew: false,
        isUp: false,
        isDown: false,
      }),
    ).toBeNull();
  });
});

describe("mapKeywordItem", () => {
  it("maps intent, rank change, and SERP occupancy from a ranked keyword", () => {
    const mapped = mapKeywordItem({
      keyword_data: {
        keyword: "seo audit",
        keyword_info: { search_volume: 1200, cpc: 4.2 },
        keyword_properties: { keyword_difficulty: 38 },
        search_intent_info: { main_intent: "commercial" },
      },
      ranked_serp_element: {
        serp_item: {
          type: "featured_snippet",
          url: "https://example.com/audit",
          relative_url: "/audit",
          rank_absolute: 1,
          etv: 80,
          estimated_paid_traffic_cost: 12.5,
          rank_changes: {
            previous_rank_absolute: 4,
            is_new: false,
            is_up: true,
            is_down: false,
          },
        },
        serp_item_types: ["featured_snippet", "people_also_ask"],
        is_lost: false,
        last_updated_time: "2026-08-01 00:00:00 +00:00",
        previous_updated_time: "2026-07-01 00:00:00 +00:00",
      },
    });

    expect(mapped).toMatchObject({
      keyword: "seo audit",
      position: 1,
      previousPosition: 4,
      intent: "commercial",
      change: "improved",
      occupiedType: "featured_snippet",
      serpFeatures: ["featured_snippet", "people_also_ask"],
      trafficCost: 12.5,
    });
    expect(normalizeSearchIntent("not-an-intent")).toBeNull();
  });
});
