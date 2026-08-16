import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: {} }));

import { analyzeBacklinkSnapshotChange } from "./BacklinkChangeEventService";

function snapshot(id: number, referringDomains: number, backlinks = 500) {
  return {
    id,
    projectId: "project-1",
    domain: "example.com",
    rank: 20,
    backlinks,
    referringDomains,
    brokenBacklinks: 0,
    newBacklinks: 0,
    lostBacklinks: 0,
    newReferringDomains: 0,
    lostReferringDomains: 0,
    capturedAt: `2026-08-${id.toString().padStart(2, "0")}T00:00:00.000Z`,
  };
}

describe("analyzeBacklinkSnapshotChange", () => {
  it("reports a material referring-domain loss", () => {
    expect(
      analyzeBacklinkSnapshotChange(snapshot(1, 100), snapshot(2, 93)),
    ).toMatchObject({
      direction: "lost",
      difference: 7,
      previousReferringDomains: 100,
      currentReferringDomains: 93,
    });
  });

  it("reports a material referring-domain gain", () => {
    expect(
      analyzeBacklinkSnapshotChange(snapshot(1, 20), snapshot(2, 23)),
    ).toMatchObject({ direction: "gained", difference: 3 });
  });

  it("ignores small fluctuations and mismatched domains", () => {
    expect(
      analyzeBacklinkSnapshotChange(snapshot(1, 100), snapshot(2, 102)),
    ).toBeNull();
    expect(
      analyzeBacklinkSnapshotChange(snapshot(1, 100), {
        ...snapshot(2, 90),
        domain: "other.example",
      }),
    ).toBeNull();
  });
});
