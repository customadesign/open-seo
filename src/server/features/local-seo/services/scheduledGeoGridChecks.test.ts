import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDueGeoGridConfigs: vi.fn(),
  claimDueGeoGridConfig: vi.fn(),
  customerHasPaidPlan: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
  runGrid: vi.fn(),
  computeNextGeoGridRun: vi.fn(),
}));

vi.mock("@/server/billing/subscription", () => ({
  customerHasPaidPlan: mocks.customerHasPaidPlan,
}));
vi.mock("@/server/features/local-seo/repositories/LocalSeoRepository", () => ({
  LocalSeoRepository: {
    getDueGeoGridConfigs: mocks.getDueGeoGridConfigs,
    claimDueGeoGridConfig: mocks.claimDueGeoGridConfig,
  },
}));
vi.mock("@/server/features/local-seo/services/GeoGridService", () => ({
  computeNextGeoGridRun: mocks.computeNextGeoGridRun,
  GeoGridService: { runGrid: mocks.runGrid },
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: mocks.isHostedServerAuthMode,
}));

import { runScheduledGeoGridChecks } from "./scheduledGeoGridChecks";

const due = {
  organizationId: "organization-1",
  config: {
    id: "config-1",
    projectId: "project-1",
    scheduleInterval: "weekly" as const,
    nextRunAt: "2026-08-13T04:30:00.000Z",
  },
};

describe("runScheduledGeoGridChecks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDueGeoGridConfigs.mockResolvedValue([due]);
    mocks.claimDueGeoGridConfig.mockResolvedValue(true);
    mocks.customerHasPaidPlan.mockResolvedValue(true);
    mocks.isHostedServerAuthMode.mockResolvedValue(true);
    mocks.computeNextGeoGridRun.mockReturnValue("2026-08-20T04:30:00.000Z");
    mocks.runGrid.mockResolvedValue({ started: true, run: { id: "run-1" } });
  });

  it("claims a due slot before starting metered work", async () => {
    await expect(runScheduledGeoGridChecks()).resolves.toMatchObject({
      started: 1,
      errors: 0,
    });

    expect(mocks.claimDueGeoGridConfig).toHaveBeenCalledWith({
      configId: "config-1",
      projectId: "project-1",
      observedNextRunAt: "2026-08-13T04:30:00.000Z",
      nextRunAt: "2026-08-20T04:30:00.000Z",
    });
    expect(
      mocks.claimDueGeoGridConfig.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.runGrid.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(mocks.runGrid).toHaveBeenCalledWith({
      configId: "config-1",
      projectId: "project-1",
      billingCustomer: {
        organizationId: "organization-1",
        projectId: "project-1",
        userId: "system",
        userEmail: "system@openseo.so",
      },
    });
  });

  it("advances a free hosted account without spending credits", async () => {
    mocks.customerHasPaidPlan.mockResolvedValue(false);

    await expect(runScheduledGeoGridChecks()).resolves.toMatchObject({
      skippedFree: 1,
      started: 0,
    });
    expect(mocks.runGrid).not.toHaveBeenCalled();
  });

  it("restores the due slot when another run is already active", async () => {
    mocks.runGrid.mockResolvedValue({
      started: false,
      run: { id: "blocking-run" },
    });

    await expect(runScheduledGeoGridChecks()).resolves.toMatchObject({
      alreadyRunning: 1,
      started: 0,
    });
    expect(mocks.claimDueGeoGridConfig).toHaveBeenNthCalledWith(2, {
      configId: "config-1",
      projectId: "project-1",
      observedNextRunAt: "2026-08-20T04:30:00.000Z",
      nextRunAt: "2026-08-13T04:30:00.000Z",
    });
  });
});
