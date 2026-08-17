import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CONFIGS_PER_PROJECT } from "@/shared/rank-tracking";
import { RankTrackingService } from "./RankTrackingService";

const mocks = vi.hoisted(() => ({
  getConfigByProjectDomainLocation: vi.fn(),
  getConfigById: vi.fn(),
  getConfigsForProject: vi.fn(),
  createConfig: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/dataforseo", () => ({ createDataforseoClient: vi.fn() }));
vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);

const archivedConfig = {
  id: "config_archived",
  projectId: "project_1",
  domain: "acme.com",
  locationCode: 2840,
  languageCode: "en",
  devices: "both" as const,
  serpDepth: 20,
  scheduleInterval: "weekly" as const,
  isActive: false,
  maxCostCredits: null,
  lastSkipReason: "insufficient_credits",
};

const baseInput = {
  projectId: "project_1",
  projectMarket: { locationCode: 2704, languageCode: "vi" },
  domain: "acme.com",
  locationCode: 2840,
  languageCode: "es",
  devices: "desktop" as const,
  serpDepth: 40,
  scheduleInterval: "daily" as const,
  maxCostCredits: 500,
};

describe("RankTrackingService.createConfig", () => {
  beforeEach(() => {});

  it("reactivates an archived config instead of throwing, applying the new settings", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(archivedConfig);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.updateConfig.mockResolvedValue(undefined);
    mocks.getConfigById.mockResolvedValue({
      ...archivedConfig,
      languageCode: "es",
      devices: "desktop",
      serpDepth: 40,
      scheduleInterval: "daily",
      isActive: true,
      lastSkipReason: null,
    });

    await expect(
      RankTrackingService.createConfig(baseInput),
    ).resolves.toMatchObject({
      id: "config_archived",
      isActive: true,
      languageCode: "es",
      devices: "desktop",
    });

    expect(mocks.updateConfig).toHaveBeenCalledTimes(1);
    expect(mocks.updateConfig).toHaveBeenCalledWith(
      "config_archived",
      "project_1",
      expect.objectContaining({
        isActive: true,
        languageCode: "es",
        devices: "desktop",
        serpDepth: 40,
        scheduleInterval: "daily",
        lastSkipReason: null,
      }),
    );
    // Reactivation must not insert a duplicate row.
    expect(mocks.createConfig).not.toHaveBeenCalled();
  });

  it("throws when an active config already tracks the same domain + location", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue({
      ...archivedConfig,
      isActive: true,
    });

    await expect(
      RankTrackingService.createConfig(baseInput),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(mocks.createConfig).not.toHaveBeenCalled();
  });

  it("keys the duplicate check on locationName so national and city configs coexist", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);

    // Local config: the lookup must be scoped to this exact city, so an
    // existing national row for the same domain doesn't collide.
    await RankTrackingService.createConfig({
      ...baseInput,
      locationName: "Enid,Oklahoma,United States",
    });
    expect(mocks.getConfigByProjectDomainLocation).toHaveBeenCalledWith(
      "project_1",
      "acme.com",
      "google",
      2840,
      "Enid,Oklahoma,United States",
    );

    // National config: the lookup is scoped to NULL locationName.
    await RankTrackingService.createConfig(baseInput);
    expect(mocks.getConfigByProjectDomainLocation).toHaveBeenLastCalledWith(
      "project_1",
      "acme.com",
      "google",
      2840,
      null,
    );
  });

  it("rejects reactivating an archived config when the project is at the active-config cap", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(archivedConfig);
    mocks.getConfigsForProject.mockResolvedValue(
      Array.from({ length: MAX_CONFIGS_PER_PROJECT }, (_, i) => ({
        ...archivedConfig,
        id: `config_${i}`,
        isActive: true,
      })),
    );

    await expect(
      RankTrackingService.createConfig(baseInput),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(mocks.createConfig).not.toHaveBeenCalled();
  });

  it("creates a new config when none exists for the domain + location", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);

    const result = await RankTrackingService.createConfig(baseInput);

    expect(result.id).toBeTruthy();
    expect(mocks.createConfig).toHaveBeenCalledTimes(1);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(mocks.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.id,
        projectId: "project_1",
        domain: "acme.com",
        devices: "desktop",
        serpDepth: 40,
        scheduleInterval: "daily",
      }),
    );
  });

  it("uses the project's market when location and language are omitted", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);

    await RankTrackingService.createConfig({
      projectId: "project_1",
      projectMarket: { locationCode: 2704, languageCode: "vi" },
      domain: "acme.com",
      serpDepth: 40,
    });

    expect(mocks.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({ locationCode: 2704, languageCode: "vi" }),
    );
  });

  it("snaps the language when only location overrides the project market", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);

    await RankTrackingService.createConfig({
      projectId: "project_1",
      projectMarket: { locationCode: 2704, languageCode: "vi" },
      domain: "acme.com",
      locationCode: 2276,
      serpDepth: 40,
    });

    expect(mocks.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({ locationCode: 2276, languageCode: "de" }),
    );
  });
});

// A recurring, non-archived tracker is a standing authorization to spend, so
// the approved ceiling is what makes that authorization explicit.
describe("RankTrackingService recurring spend approval", () => {
  const activeConfig = {
    ...archivedConfig,
    id: "config_1",
    isActive: true,
    maxCostCredits: 500,
  };

  it("creates a manual tracker with no schedule anchor when no cadence is asked for", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);
    mocks.createConfig.mockResolvedValue(undefined);

    await RankTrackingService.createConfig({
      projectId: "project_1",
      projectMarket: { locationCode: 2840, languageCode: "en" },
      domain: "acme.com",
      serpDepth: 20,
    });

    expect(mocks.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleInterval: "manual",
        nextCheckAt: null,
        maxCostCredits: null,
      }),
    );
  });

  it("refuses to create a recurring tracker without an approved ceiling", async () => {
    mocks.getConfigByProjectDomainLocation.mockResolvedValue(null);
    mocks.getConfigsForProject.mockResolvedValue([]);

    await expect(
      RankTrackingService.createConfig({
        projectId: "project_1",
        projectMarket: { locationCode: 2840, languageCode: "en" },
        domain: "acme.com",
        serpDepth: 20,
        scheduleInterval: "weekly",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.createConfig).not.toHaveBeenCalled();
  });

  // The legacy shape: an active weekly row migrated in with no ceiling. Editing
  // it must not be a way to keep the schedule while dodging the approval.
  it("refuses a recurring edit that leaves the ceiling unset or at zero", async () => {
    mocks.getConfigById.mockResolvedValue({
      ...activeConfig,
      maxCostCredits: null,
    });

    await expect(
      RankTrackingService.updateConfig("config_1", "project_1", {
        serpDepth: 20,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      RankTrackingService.updateConfig("config_1", "project_1", {
        maxCostCredits: 0,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });

  it("accepts a recurring edit that supplies the ceiling in the same request", async () => {
    mocks.getConfigById.mockResolvedValue({
      ...activeConfig,
      scheduleInterval: "manual",
      maxCostCredits: null,
    });

    await RankTrackingService.updateConfig("config_1", "project_1", {
      scheduleInterval: "weekly",
      maxCostCredits: 40,
    });

    expect(mocks.updateConfig.mock.lastCall?.[2]).toMatchObject({
      scheduleInterval: "weekly",
      maxCostCredits: 40,
    });
  });
});
