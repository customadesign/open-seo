import { describe, expect, it } from "vitest";
import { clusterKeywords } from "./cluster-keywords";

describe("clusterKeywords", () => {
  it("groups keywords that share a content phrase and names the cluster from that phrase", () => {
    const clusters = clusterKeywords([
      { keyword: "best crm software", searchVolume: 1000 },
      { keyword: "crm software pricing", searchVolume: 800 },
      { keyword: "free crm software", searchVolume: 600 },
      { keyword: "email marketing tools", searchVolume: 500 },
      { keyword: "email marketing software", searchVolume: 400 },
      { keyword: "email marketing examples", searchVolume: 300 },
    ]);

    const names = clusters.map((cluster) => cluster.name);
    expect(names).toContain("Crm Software");
    expect(names).toContain("Email Marketing");

    const crm = clusters.find((cluster) => cluster.name === "Crm Software");
    expect(crm?.keywords).toEqual([
      "best crm software",
      "crm software pricing",
      "free crm software",
    ]);
  });

  it("returns the same cluster names for the same input", () => {
    const rows = [
      { keyword: "local seo checklist", searchVolume: 200 },
      { keyword: "local seo audit", searchVolume: 180 },
      { keyword: "local seo tools", searchVolume: 160 },
      { keyword: "on page seo guide", searchVolume: 140 },
      { keyword: "on page seo checklist", searchVolume: 120 },
      { keyword: "on page seo examples", searchVolume: 100 },
    ];

    expect(clusterKeywords(rows).map((cluster) => cluster.name)).toEqual(
      clusterKeywords(rows).map((cluster) => cluster.name),
    );
  });

  it("folds leftover singletons into Other", () => {
    const clusters = clusterKeywords([
      { keyword: "unique widget", searchVolume: 10 },
      { keyword: "totally different phrase", searchVolume: 8 },
    ]);

    expect(clusters).toEqual([
      {
        name: "Other",
        keywords: ["totally different phrase", "unique widget"],
      },
    ]);
  });

  it("caps named clusters at 50 and folds the rest into Other", () => {
    const rows = Array.from({ length: 60 }, (_, index) => {
      const topic = `topic${String(index).padStart(2, "0")}`;
      return [
        { keyword: `${topic} guide`, searchVolume: 100 - index },
        { keyword: `${topic} tools`, searchVolume: 90 - index },
        { keyword: `${topic} examples`, searchVolume: 80 - index },
      ];
    }).flat();

    const clusters = clusterKeywords(rows);
    const named = clusters.filter((cluster) => cluster.name !== "Other");
    const other = clusters.find((cluster) => cluster.name === "Other");

    expect(named).toHaveLength(50);
    expect(other?.keywords.length).toBeGreaterThan(0);
    expect(named[0].keywords.length).toBeGreaterThanOrEqual(
      named[named.length - 1].keywords.length,
    );
  });
});
