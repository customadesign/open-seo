import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));
import { serpDetailStatus } from "@/shared/rank-serp-retention";
import { retainedSerpRuns } from "./rankTrackingReportContext";

describe("retainedSerpRuns", () => {
  const snapshots = [
    {
      runId: "never",
      serpCaptured: false,
      device: "desktop" as const,
    },
    {
      runId: "kept",
      serpCaptured: true,
      device: "desktop" as const,
    },
    {
      runId: "pruned",
      serpCaptured: true,
      device: "desktop" as const,
    },
  ];
  const runs = [
    { id: "kept", startedAt: "2026-08-18", serpPruned: false },
    { id: "pruned", startedAt: "2026-08-01", serpPruned: true },
    { id: "never", startedAt: "2026-07-01", serpPruned: false },
  ];

  it("keeps captured unpruned checks and drops pruned or never-captured ones", () => {
    const retained = retainedSerpRuns(snapshots as never, runs, "desktop");
    expect(retained.map((run) => run.id)).toEqual(["kept"]);
  });

  it("reports a pruned captured check as pruned, not as never-captured", () => {
    expect(
      serpDetailStatus({
        capturedRunCount: 2,
        retainedRunCount: 0,
      }),
    ).toBe("pruned");
    expect(
      serpDetailStatus({
        capturedRunCount: 0,
        retainedRunCount: 0,
      }),
    ).toBe("none");
  });
});
