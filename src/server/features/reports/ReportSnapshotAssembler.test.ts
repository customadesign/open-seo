import { describe, expect, it } from "vitest";
import {
  assembleReportSnapshot,
  stableReportSnapshotJson,
} from "./ReportSnapshotAssembler";

describe("report snapshot assembly", () => {
  it("keeps template section order and produces canonical JSON", async () => {
    const snapshot = await assembleReportSnapshot(
      {
        generatedAt: "2026-08-13T12:00:00.000Z",
        project: { id: "project-1", name: "Site", domain: "example.com" },
        periodStart: "2026-07-13T00:00:00.000Z",
        periodEnd: "2026-08-13T00:00:00.000Z",
        branding: {
          brandName: "OpenSEO",
          logoUrl: null,
          primaryColor: "#2563eb",
          accentColor: "#0f172a",
        },
        sections: [
          { key: "gsc", enabled: true },
          { key: "rank", enabled: true },
          { key: "ga4", enabled: true },
        ],
      },
      {
        async load(key) {
          if (key === "ga4") return { status: "not_configured" };
          return {
            status: "available",
            data: key === "gsc" ? { z: 1, a: 2 } : { rows: [] },
          };
        },
      },
    );

    expect(snapshot.sections.map((section) => section.key)).toEqual([
      "gsc",
      "rank",
    ]);
    expect(snapshot.omissions).toEqual([
      { key: "ga4", reason: "not_configured" },
    ]);
    expect(stableReportSnapshotJson(snapshot)).toContain(
      '"data":{"a":2,"z":1}',
    );
  });
});
