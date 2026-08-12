import { describe, expect, it, vi } from "vitest";
import type { LocalBusinessProfile } from "@/types/schemas/local-seo";
import {
  recordCitationAuditSchema,
  saveLocalListingConnectionSchema,
} from "@/types/schemas/local-seo";
import {
  classifyCitationEvidence,
  normalizeAddress,
  normalizeBusinessName,
  normalizePhone,
  normalizeWebsite,
} from "./CitationAuditService";

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/runBatch", () => ({
  executeInBatches: vi.fn(),
  runBatch: vi.fn(),
}));

const profile: LocalBusinessProfile = {
  id: "profile-1",
  projectId: "project-1",
  name: "Murphy Consulting, LLC",
  addressLine1: "123 Main Street",
  addressLine2: "Suite 400",
  locality: "Dallas",
  region: "TX",
  postalCode: "75201",
  countryCode: "US",
  phone: "+1 (214) 555-0100",
  websiteUrl: "https://www.murphy.example/",
  latitude: 32.7767,
  longitude: -96.797,
  googlePlaceId: null,
  googleCid: null,
  isPrimary: true,
  verifiedAt: null,
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("NAP normalization", () => {
  it("normalizes common name, address, phone, and website presentation differences", () => {
    expect(normalizeBusinessName("MURPHY Consulting Incorporated")).toBe(
      normalizeBusinessName(profile.name),
    );
    expect(
      normalizeAddress("123 North Main St., #400, Dallas TX 75201 USA"),
    ).toBe(
      normalizeAddress(
        "123 N Main Street Suite 400 Dallas TX 75201 United States",
      ),
    );
    expect(normalizePhone("214.555.0100")).toBe(normalizePhone(profile.phone));
    expect(normalizeWebsite("murphy.example/")).toBe(
      normalizeWebsite(profile.websiteUrl),
    );
  });
});

describe("classifyCitationEvidence", () => {
  it("confirms a match only when all four NAP+W fields have affirmative evidence", () => {
    expect(
      classifyCitationEvidence(profile, {
        directoryKey: "example",
        sourceUrl: "https://directory.example/murphy",
        evidenceKind: "found",
        observedName: "Murphy Consulting Inc",
        observedAddress: "123 Main St, Dallas, TX 75201 US",
        observedPhone: "214-555-0100",
        observedWebsiteUrl: "https://murphy.example",
      }),
    ).toEqual({
      status: "confirmed_match",
      nameMatches: true,
      addressMatches: true,
      phoneMatches: true,
      websiteMatches: true,
    });
  });

  it("keeps missing field evidence unknown instead of calling it a match", () => {
    expect(
      classifyCitationEvidence(profile, {
        directoryKey: "partial",
        sourceUrl: "https://directory.example/partial",
        evidenceKind: "found",
        observedName: "Murphy Consulting",
      }),
    ).toEqual({
      status: "found_unverified",
      nameMatches: true,
      addressMatches: null,
      phoneMatches: null,
      websiteMatches: null,
    });
  });

  it("keeps a source-less provider row unverified even when every field matches", () => {
    expect(
      classifyCitationEvidence(profile, {
        directoryKey: "source-missing",
        evidenceKind: "found",
        sourceUrl: null,
        observedName: "Murphy Consulting",
        observedAddress: "123 Main St Dallas TX 75201 US",
        observedPhone: "214-555-0100",
        observedWebsiteUrl: "https://murphy.example",
      }),
    ).toMatchObject({
      status: "found_unverified",
      nameMatches: true,
      addressMatches: true,
      phoneMatches: true,
      websiteMatches: true,
    });
  });

  it("preserves blocked and not-found states without inventing comparisons", () => {
    for (const [evidenceKind, status] of [
      ["blocked", "blocked"],
      ["not_found", "not_found"],
    ] as const) {
      expect(
        classifyCitationEvidence(profile, {
          directoryKey: evidenceKind,
          evidenceKind,
        }),
      ).toEqual({
        status,
        nameMatches: null,
        addressMatches: null,
        phoneMatches: null,
        websiteMatches: null,
      });
    }
  });

  it("records a known mismatch even when the other fields match", () => {
    expect(
      classifyCitationEvidence(profile, {
        directoryKey: "wrong-phone",
        sourceUrl: "https://directory.example/wrong-phone",
        evidenceKind: "found",
        observedName: "Murphy Consulting",
        observedAddress: "123 Main Street Dallas TX 75201 US",
        observedPhone: "214-555-9999",
        observedWebsiteUrl: "https://murphy.example",
      }).status,
    ).toBe("confirmed_mismatch");
  });
});

describe("citation input evidence safety", () => {
  it("rejects non-HTTP management and evidence URLs", () => {
    expect(
      saveLocalListingConnectionSchema.safeParse({
        projectId: "11111111-1111-4111-8111-111111111111",
        profileId: "22222222-2222-4222-8222-222222222222",
        ghlLocationId: "location-1",
        engine: "yext",
        status: "active",
        managementUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate unknown observations for the same directory", () => {
    expect(
      recordCitationAuditSchema.safeParse({
        projectId: "11111111-1111-4111-8111-111111111111",
        profileId: "22222222-2222-4222-8222-222222222222",
        observations: [
          { directoryKey: "yellow_pages", evidenceKind: "not_found" },
          { directoryKey: "yellow_pages", evidenceKind: "not_found" },
        ],
      }).success,
    ).toBe(false);
  });
});
