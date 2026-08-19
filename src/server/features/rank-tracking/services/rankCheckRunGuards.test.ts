import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginRankCheckRun } from "./rankCheckRunGuards";

const mocks = vi.hoisted(() => ({
  tryCreateRun: vi.fn(),
  getActiveRunForConfig: vi.fn(),
  getRunById: vi.fn(),
  // Typed so the staleness assertion can read `mock.calls` without `any`.
  updateRun:
    vi.fn<
      (
        runId: string,
        patch: { status?: string; errorMessage?: string | null },
      ) => Promise<void>
    >(),
  getWorkflow: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    RANK_CHECK_WORKFLOW: { get: mocks.getWorkflow },
  },
}));
vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);

const run = {
  id: "run_1",
  configId: "config_1",
  projectId: "project_1",
  status: "pending" as const,
  keywordsTotal: 2,
  keywordsChecked: 0,
  isSubsetRun: false,
  errorMessage: null,
  startedAt: new Date().toISOString(),
  completedAt: null,
};

const input = {
  config: {
    id: "config_1",
    domain: "example.com",
    engine: "google" as const,
    locationCode: 2840,
    languageCode: "en",
    locationName: null,
    devices: "desktop" as const,
    serpDepth: 20,
  },
  projectId: "project_1",
  billingCustomer: {
    userId: "user_1",
    userEmail: "user@example.com",
    organizationId: "org_1",
    projectId: "project_1",
  },
  keywordsTotal: 2,
  trigger: "manual" as const,
  workflowStartErrorMessage: "failed",
};

describe("beginRankCheckRun", () => {
  beforeEach(() => {});

  it("returns the locally generated run ID without a fallible post-start read", async () => {
    mocks.tryCreateRun.mockResolvedValue(true);
    const create = vi
      .fn<(input: { params: { maxCostCredits?: number } }) => Promise<void>>()
      .mockResolvedValue(undefined);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only create is exercised by this unit test
    const workflow = { create } as unknown as Env["RANK_CHECK_WORKFLOW"];

    const result = await beginRankCheckRun({ ...input, workflow });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected a created run");
    expect(result.runId).toEqual(expect.any(String));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].params.maxCostCredits).toBeUndefined();
    expect(mocks.getRunById).not.toHaveBeenCalled();
  });

  it("passes the approved credit ceiling into the workflow payload", async () => {
    mocks.tryCreateRun.mockResolvedValue(true);
    const create = vi
      .fn<(input: { params: { maxCostCredits?: number } }) => Promise<void>>()
      .mockResolvedValue(undefined);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only create is exercised by this unit test
    const workflow = { create } as unknown as Env["RANK_CHECK_WORKFLOW"];

    await beginRankCheckRun({
      ...input,
      workflow,
      maxCostCredits: 12,
    });

    expect(create.mock.calls[0]?.[0].params.maxCostCredits).toBe(12);
  });

  it("does not create another workflow when a run is already active", async () => {
    const blocker = { ...run, id: "run_0", status: "running" as const };
    mocks.tryCreateRun.mockResolvedValue(false);
    mocks.getActiveRunForConfig.mockResolvedValue(blocker);
    mocks.getWorkflow.mockResolvedValue({
      status: vi.fn().mockResolvedValue({ status: "running" }),
    });
    const create = vi.fn();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- no workflow methods should run on the blocked path
    const workflow = { create } as unknown as Env["RANK_CHECK_WORKFLOW"];

    await expect(beginRankCheckRun({ ...input, workflow })).resolves.toEqual({
      ok: false,
      reason: "already_running",
      blockingRunId: "run_0",
    });
    expect(create).not.toHaveBeenCalled();
    expect(mocks.tryCreateRun).toHaveBeenCalledTimes(1);
  });

  it("frees the config after 60 minutes even while the workflow claims to be running", async () => {
    // A wedged instance holds this config's only run slot, so every scheduled
    // check for it would be blocked until someone intervened.
    const blocker = {
      ...run,
      id: "run_0",
      status: "running" as const,
      startedAt: new Date(Date.now() - 90 * 60_000).toISOString(),
    };
    mocks.tryCreateRun.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.getActiveRunForConfig.mockResolvedValue(blocker);
    mocks.getWorkflow.mockResolvedValue({
      status: vi.fn().mockResolvedValue({ status: "running" }),
    });
    const create = vi.fn().mockResolvedValue(undefined);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only create is exercised by this unit test
    const workflow = { create } as unknown as Env["RANK_CHECK_WORKFLOW"];

    const result = await beginRankCheckRun({ ...input, workflow });

    expect(result.ok).toBe(true);
    const [failedRunId, patch] = mocks.updateRun.mock.calls[0] ?? [];
    expect(failedRunId).toBe("run_0");
    expect(patch?.status).toBe("failed");
    expect(patch?.errorMessage).toContain("60 minute maximum runtime");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
