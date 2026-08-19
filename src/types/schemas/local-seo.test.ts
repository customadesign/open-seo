import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));

import { createGeoGridConfigSchema } from "./local-seo";

const base = {
  projectId: "075aafad-fd80-4e2d-9dde-5c6b46af40c5",
  profileId: "48e817f8-9b75-48c0-9854-9357668854b4",
  keyword: "sign shop",
  centerLatitude: 33.1294592,
  centerLongitude: -117.1201598,
  gridSize: 5,
  radiusMeters: 1500,
  languageCode: "en",
  device: "mobile" as const,
};

describe("createGeoGridConfigSchema", () => {
  it("defaults new trackers to manual", () => {
    expect(createGeoGridConfigSchema.parse(base).scheduleInterval).toBe(
      "manual",
    );
  });

  it("requires an approved estimate for recurring trackers", () => {
    expect(
      createGeoGridConfigSchema.safeParse({
        ...base,
        scheduleInterval: "weekly",
      }).success,
    ).toBe(false);
    expect(
      createGeoGridConfigSchema.safeParse({
        ...base,
        scheduleInterval: "weekly",
        maxEstimatedScheduledCheckCredits: 75,
      }).success,
    ).toBe(true);
  });

  it("rejects unexposed 9x9 grids and daily recurrence", () => {
    expect(
      createGeoGridConfigSchema.safeParse({ ...base, gridSize: 9 }).success,
    ).toBe(false);
    expect(
      createGeoGridConfigSchema.safeParse({
        ...base,
        scheduleInterval: "daily",
        maxEstimatedScheduledCheckCredits: 75,
      }).success,
    ).toBe(false);
  });

  it("rejects paid Maps search operators so the approved estimate stays valid", () => {
    expect(
      createGeoGridConfigSchema.safeParse({
        ...base,
        keyword: "sign shop -site:example.com",
      }).success,
    ).toBe(false);
  });
});
