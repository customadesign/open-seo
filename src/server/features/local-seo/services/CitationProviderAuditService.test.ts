import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalBusinessProfile } from "@/types/schemas/local-seo";
import {
  buildGoogleBusinessEvidence,
  CitationAuditService,
} from "./CitationAuditService";

const mocks = vi.hoisted(() => ({
  getProfileById: vi.fn(),
  getPrimaryProfile: vi.fn(),
  createCitationAuditRun: vi.fn(),
  updateCitationAuditRun: vi.fn(),
  insertCitationObservations: vi.fn(),
  businessListings: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/server/features/local-seo/repositories/LocalSeoRepository", () => ({
  LocalSeoRepository: {
    getProfileById: mocks.getProfileById,
    getPrimaryProfile: mocks.getPrimaryProfile,
    createCitationAuditRun: mocks.createCitationAuditRun,
    updateCitationAuditRun: mocks.updateCitationAuditRun,
    insertCitationObservations: mocks.insertCitationObservations,
  },
}));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => ({
    business: { businessListings: mocks.businessListings },
  }),
}));

const profile: LocalBusinessProfile = {
  id: "22222222-2222-4222-8222-222222222222",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "Example Electric LLC",
  addressLine1: "123 Main Street",
  addressLine2: null,
  locality: "Dallas",
  region: "TX",
  postalCode: "75201",
  countryCode: "US",
  phone: "+1 214-555-0100",
  websiteUrl: "https://example-electric.test",
  latitude: 32.7767,
  longitude: -96.797,
  googlePlaceId: "place-1",
  googleCid: "cid-1",
  isPrimary: true,
  verifiedAt: null,
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

const runningRun = {
  id: "run-1",
  projectId: profile.projectId,
  profileId: profile.id,
  status: "running" as const,
};

describe("DataForSEO citation provider audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrimaryProfile.mockResolvedValue(profile);
    mocks.createCitationAuditRun.mockResolvedValue(runningRun);
    mocks.updateCitationAuditRun.mockResolvedValue({
      ...runningRun,
      status: "completed",
      observationsTotal: 1,
      confirmedMatches: 0,
      confirmedMismatches: 0,
      foundUnverified: 1,
      notFound: 0,
      blocked: 0,
      errorMessage: null,
      completedAt: "2026-08-13T00:01:00.000Z",
    });
    mocks.insertCitationObservations.mockResolvedValue(undefined);
  });

  it("uses the metered business listing client and keeps partial evidence unverified", async () => {
    mocks.businessListings.mockResolvedValue([
      {
        place_id: "place-1",
        title: "Example Electric",
        address: "123 Main St Dallas TX 75201 US",
        check_url: "https://google.example/check/example-electric",
      },
    ]);

    const result = await CitationAuditService.runProviderAudit({
      projectId: profile.projectId,
      radiusKm: 5,
      resultLimit: 20,
      billingCustomer: {
        organizationId: "org-1",
        userId: "user-1",
        userEmail: "user@example.com",
        projectId: profile.projectId,
      },
    });

    expect(mocks.businessListings).toHaveBeenCalledWith({
      title: profile.name,
      locationCoordinate: "32.7767,-96.797,5",
      limit: 20,
      creditFeature: "local_seo",
    });
    expect(result.observations[0]).toMatchObject({
      directoryKey: "google_business",
      status: "found_unverified",
      nameMatches: true,
      addressMatches: true,
      phoneMatches: null,
      websiteMatches: null,
    });
    expect(result.coverage).toMatchObject({
      checkedDirectoryKeys: ["google_business"],
      multiDirectoryCoverage: false,
    });
  });

  it("records not_found when no supported target identifier matches", () => {
    expect(
      buildGoogleBusinessEvidence(profile, [
        {
          place_id: "different-place",
          title: "Different Business",
          phone: "214-555-9999",
        },
      ]),
    ).toMatchObject({
      directoryKey: "google_business",
      evidenceKind: "not_found",
      sourceUrl: null,
    });
  });
});
