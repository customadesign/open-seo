import { describe, expect, it } from "vitest";
import { periodKeyFromDate } from "@/server/features/domain/repositories/domainResearchPeriod";

describe("periodKeyFromDate", () => {
  it("uses the UTC year and month", () => {
    expect(periodKeyFromDate(new Date("2026-08-18T12:00:00.000Z"))).toBe(
      "2026-08",
    );
  });
});
