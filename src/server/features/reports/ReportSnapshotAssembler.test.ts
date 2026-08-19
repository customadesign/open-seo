import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportSnapshot } from "@/types/schemas/reports";

const mocks = vi.hoisted(() => ({
  getReportProject: vi.fn(),
  loadReportSection: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("./ReportSectionDataSource", () => mocks);

import { assembleReportSnapshot } from "./ReportSnapshotAssembler";

const range = {
  projectId: "project-1",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  compareStart: "2026-06-01",
  compareEnd: "2026-06-30",
  generatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const aiSection: Extract<
  ReportSnapshot["sections"][number],
  { key: "ai_visibility" }
> = {
  key: "ai_visibility",
  data: {
    configs: [
      {
        configId: "config-1",
        brandName: "Acme",
        domain: "acme.test",
        runId: "run-1",
        freshness: {
          capturedAt: "2026-07-20T00:00:00.000Z",
          ageDays: 11,
          isStale: false,
        },
        summary: {
          answered: 4,
          unavailable: 6,
          brandMentioned: 3,
          brandAbsent: 1,
          mentionTotal: 9,
          domainCited: 2,
          answerShare: 0.75,
        },
        previous: null,
        providers: [],
      },
    ],
    unavailable: [],
  },
};

describe("assembleReportSnapshot", () => {
  beforeEach(() => {
    mocks.getReportProject.mockResolvedValue({
      id: "project-1",
      name: "Acme",
      domain: "acme.test",
    });
  });

  it("summarises AI visibility against answered prompts and names the unavailable ones", async () => {
    mocks.loadReportSection.mockResolvedValue({
      status: "loaded",
      section: aiSection,
    });

    const snapshot = await assembleReportSnapshot({
      ...range,
      sections: [{ key: "ai_visibility", enabled: true }],
    });

    // 3 of 4 — the 6 prompts nothing answered are named, never used as the
    // denominator, which would have understated this as 3 of 10.
    expect(snapshot.evidence).toContainEqual({
      key: "ai_visibility.brand_mentions",
      label: "AI answers mentioning the brand",
      value: "3 of 4 (6 unavailable)",
      direction: "positive",
    });
  });

  it("records a disabled stored section as an omission instead of loading it", async () => {
    const snapshot = await assembleReportSnapshot({
      ...range,
      sections: [{ key: "local_geo_grid", enabled: false }],
    });

    expect(mocks.loadReportSection).not.toHaveBeenCalled();
    expect(snapshot.omissions).toEqual([
      { key: "local_geo_grid", reason: "disabled" },
    ]);
  });
});
