import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/lib/errors";

const mocks = vi.hoisted(() => ({
  getDueGeoGridConfigs: vi.fn(),
  claimDueGeoGridConfig: vi.fn(),
  customerHasPaidPlan: vi.fn(),
  isHostedServerAuthMode: vi.fn(),
  runGrid: vi.fn(),
  nextFutureGeoGridRun: vi.fn(),
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
  nextFutureGeoGridRun: mocks.nextFutureGeoGridRun,
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
    mocks.nextFutureGeoGridRun.mockReturnValue("2026-08-20T04:30:00.000Z");
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
      skipFailedRunResume: true,
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

  it("retries the exact failed scheduled run once", async () => {
    mocks.runGrid
      .mockRejectedValueOnce(
        new AppError("UPSTREAM_UNAVAILABLE", undefined, {
          geoGridRunId: "run-failed",
        }),
      )
      .mockResolvedValueOnce({
        started: true,
        run: { id: "run-failed", status: "completed" },
      });

    await expect(runScheduledGeoGridChecks()).resolves.toMatchObject({
      retryRecovered: 1,
      retryExhausted: 0,
      errors: 0,
    });
    expect(mocks.runGrid).toHaveBeenNthCalledWith(2, {
      configId: "config-1",
      projectId: "project-1",
      billingCustomer: {
        organizationId: "organization-1",
        projectId: "project-1",
        userId: "system",
        userEmail: "system@openseo.so",
      },
      resumeRunId: "run-failed",
    });
    expect(mocks.claimDueGeoGridConfig).toHaveBeenCalledOnce();
  });

  it("does not attempt a third run when the exact retry fails", async () => {
    mocks.runGrid
      .mockRejectedValueOnce(
        new AppError("RATE_LIMITED", undefined, {
          geoGridRunId: "run-failed",
        }),
      )
      .mockRejectedValueOnce(new AppError("UPSTREAM_UNAVAILABLE"));

    await expect(runScheduledGeoGridChecks()).resolves.toMatchObject({
      retryRecovered: 0,
      retryExhausted: 1,
      errors: 1,
    });
    expect(mocks.claimDueGeoGridConfig).toHaveBeenCalledOnce();
    expect(mocks.runGrid).toHaveBeenCalledTimes(2);
  });

  it("does not retry an unbound or non-provider failure", async () => {
    mocks.runGrid.mockRejectedValue(new AppError("UPSTREAM_UNAVAILABLE"));

    await expect(runScheduledGeoGridChecks()).resolves.toMatchObject({
      retryRecovered: 0,
      retryExhausted: 0,
      errors: 1,
    });
    expect(mocks.runGrid).toHaveBeenCalledOnce();
  });
});
