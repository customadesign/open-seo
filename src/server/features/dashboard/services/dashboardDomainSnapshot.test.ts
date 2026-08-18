import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDomainOverviewSnapshot } from "./dashboardDomainSnapshot";

const mocks = vi.hoisted(() => ({
  getRecentForProject: vi.fn(),
  insert: vi.fn(),
  getOverview: vi.fn(),
}));

vi.mock(
  "@/server/features/dashboard/repositories/DomainOverviewSnapshotRepository",
  () => ({
    DomainOverviewSnapshotRepository: {
      getRecentForProject: mocks.getRecentForProject,
      insert: mocks.insert,
    },
  }),
);
vi.mock("@/server/features/domain/services/DomainService", () => ({
  DomainService: { getOverview: mocks.getOverview },
}));

const input = {
  projectId: "project_1",
  domain: "acme.com",
  locationCode: 2840,
  languageCode: "en",
  billingCustomer: {
    userId: "user_1",
    userEmail: "user@example.com",
    organizationId: "org_1",
    projectId: "project_1",
  },
};

const snapshot = (overrides: { capturedAt: string; domain?: string }) => ({
  domain: "acme.com",
  ...overrides,
});

describe("ensureDomainOverviewSnapshot", () => {
  beforeEach(() => {
    mocks.getRecentForProject.mockResolvedValue([]);
    mocks.getOverview.mockResolvedValue({
      organicTraffic: 1200,
      organicKeywords: 340,
    });
  });

  it("takes a first snapshot from the domain overview", async () => {
    await ensureDomainOverviewSnapshot(input);

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project_1",
        domain: "acme.com",
        organicTraffic: 1200,
        organicKeywords: 340,
      }),
    );
  });

  it("spends nothing while today's snapshot is still fresh", async () => {
    mocks.getRecentForProject.mockResolvedValue([
      snapshot({ capturedAt: new Date().toISOString() }),
    ]);

    await ensureDomainOverviewSnapshot(input);

    expect(mocks.getOverview).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("refreshes when the only snapshot describes a different domain", async () => {
    mocks.getRecentForProject.mockResolvedValue([
      snapshot({ capturedAt: new Date().toISOString(), domain: "old.com" }),
    ]);

    await ensureDomainOverviewSnapshot(input);

    expect(mocks.getOverview).toHaveBeenCalledTimes(1);
  });

  it("keeps the stale snapshot when the provider call fails", async () => {
    mocks.getRecentForProject.mockResolvedValue([
      snapshot({ capturedAt: "2020-01-01T00:00:00.000Z" }),
    ]);
    mocks.getOverview.mockRejectedValue(new Error("provider down"));

    await expect(ensureDomainOverviewSnapshot(input)).resolves.toBeUndefined();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("surfaces the failure when there is no snapshot to fall back on", async () => {
    mocks.getOverview.mockRejectedValue(new Error("provider down"));

    await expect(ensureDomainOverviewSnapshot(input)).rejects.toThrow(
      "provider down",
    );
  });
});
