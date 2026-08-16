import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalListingService } from "./LocalListingService";

const mocks = vi.hoisted(() => ({
  getProfileById: vi.fn(),
  getPrimaryProfile: vi.fn(),
  getListingConnection: vi.fn(),
  upsertListingConnection: vi.fn(),
  savePrimaryProfile: vi.fn(),
}));

vi.mock("@/server/features/local-seo/repositories/LocalSeoRepository", () => ({
  LocalSeoRepository: {
    getProfileById: mocks.getProfileById,
    getPrimaryProfile: mocks.getPrimaryProfile,
    getListingConnection: mocks.getListingConnection,
    upsertListingConnection: mocks.upsertListingConnection,
    savePrimaryProfile: mocks.savePrimaryProfile,
  },
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const profile = { id: profileId, projectId, name: "Example Business" };

describe("LocalListingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfileById.mockResolvedValue(profile);
    mocks.getPrimaryProfile.mockResolvedValue(profile);
  });

  it("stores operator-entered listing status as unverified manual evidence", async () => {
    mocks.upsertListingConnection.mockResolvedValue({ id: "connection-1" });

    await LocalListingService.saveConnection({
      projectId,
      profileId,
      ghlLocationId: "location-1",
      engine: "yext",
      status: "active",
      managementUrl: "https://app.example/listings",
      lastError: null,
    });

    expect(mocks.upsertListingConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        statusSource: "manual",
        lastVerifiedAt: null,
      }),
    );
  });

  it("routes primary profile changes through the atomic repository write", async () => {
    mocks.savePrimaryProfile.mockResolvedValue(profile);

    await LocalListingService.saveProfile({
      projectId,
      profileId,
      name: "Example Business",
      addressLine1: "123 Main St",
      addressLine2: null,
      locality: "Dallas",
      region: "TX",
      postalCode: "75201",
      countryCode: "US",
      phone: "+1 214 555 0100",
      websiteUrl: "https://example.com",
      latitude: 32.7767,
      longitude: -96.797,
      googlePlaceId: null,
      googleCid: null,
      isPrimary: true,
      verifiedAt: null,
    });

    expect(mocks.savePrimaryProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: profileId, projectId, isPrimary: true }),
      true,
    );
  });

  it("reports stored manual status as unverified and never claims a live check", async () => {
    mocks.getListingConnection.mockResolvedValue({
      id: "connection-1",
      status: "active",
      statusSource: "manual",
      lastVerifiedAt: "2026-08-13T00:00:00.000Z",
    });

    await expect(
      LocalListingService.getListingStatus(projectId),
    ).resolves.toMatchObject({
      verification: "unverified",
      liveProviderCheckPerformed: false,
    });
  });
});
