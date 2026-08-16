import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLocalListingStatusTool,
  recordCitationEvidenceTool,
} from "./local-seo-tools";
import { makeToolContext } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  getListingStatus: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
vi.mock("@/server/features/local-seo/services/LocalListingService", () => ({
  LocalListingService: { getListingStatus: mocks.getListingStatus },
}));
vi.mock("@/server/features/local-seo/services/GeoGridService", () => ({
  GeoGridService: { getHistory: vi.fn(), runGrid: vi.fn() },
}));
vi.mock("@/server/features/local-seo/services/CitationAuditService", () => ({
  CitationAuditService: {
    getAudits: vi.fn(),
    recordAudit: mocks.recordAudit,
  },
}));

const projectId = "11111111-1111-4111-8111-111111111111";

describe("local SEO MCP project authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a caller-supplied project outside the token organization before any local SEO read", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);

    await expect(
      getLocalListingStatusTool.handler(
        { projectId },
        makeToolContext({ organizationId: "org-a" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.getProjectForOrganization).toHaveBeenCalledWith(
      "org-a",
      projectId,
    );
    expect(mocks.getListingStatus).not.toHaveBeenCalled();
  });

  it("performs the read only after the shared project authorization gate succeeds", async () => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: projectId,
      domain: "example.com",
      locationCode: 2840,
      languageCode: "en",
    });
    mocks.getListingStatus.mockResolvedValue({
      profile: null,
      connection: null,
      verification: "not_configured",
      liveProviderCheckPerformed: false,
    });

    const result = await getLocalListingStatusTool.handler(
      { projectId },
      makeToolContext({ organizationId: "org-a" }),
    );

    expect(mocks.getListingStatus).toHaveBeenCalledWith(projectId, undefined);
    expect(result.structuredContent).toMatchObject({
      listing: {
        verification: "not_configured",
        liveProviderCheckPerformed: false,
      },
      meta: { projectId },
    });
  });

  it("records supplied citation evidence only after project authorization", async () => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: projectId,
      domain: "example.com",
      locationCode: 2840,
      languageCode: "en",
    });
    mocks.recordAudit.mockResolvedValue({
      run: { id: "audit-1" },
      observations: [{ id: "observation-1" }],
    });
    const input = {
      projectId,
      profileId: "22222222-2222-4222-8222-222222222222",
      observations: [
        {
          directoryKey: "bing_places",
          evidenceKind: "found" as const,
          sourceUrl: "https://www.bing.com/maps/example",
          observedName: "Example Business",
        },
      ],
    };

    const result = await recordCitationEvidenceTool.handler(
      input,
      makeToolContext({ organizationId: "org-a" }),
    );

    expect(mocks.getProjectForOrganization).toHaveBeenCalledWith(
      "org-a",
      projectId,
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(input);
    expect(result.structuredContent).toMatchObject({
      run: { id: "audit-1" },
      observations: [{ id: "observation-1" }],
    });
  });
});
