import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHostedContext } from "./hosted";

const SHARED = "shared-workspace";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  getSession: vi.fn(),
  getHostedPrincipal: vi.fn(),
  findFirstOrganizationIdForUser: vi.fn(),
  getOrCreateDefaultHostedOrganization: vi.fn(),
  updateActiveOrganization: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));

vi.mock("@/lib/auth", () => ({
  hasHostedAuthConfig: () => true,
  getAuth: () => ({
    api: {
      getSession: mocks.getSession,
      createOrganization: vi.fn(),
      setActiveOrganization: mocks.updateActiveOrganization,
    },
  }),
}));

vi.mock("@/server/auth/default-hosted-organization", () => ({
  getOrCreateDefaultHostedOrganization:
    mocks.getOrCreateDefaultHostedOrganization,
}));

vi.mock("@/server/auth/repositories/AuthRepository", () => ({
  AuthRepository: {
    findFirstOrganizationIdForUser: mocks.findFirstOrganizationIdForUser,
  },
}));

vi.mock("@/server/auth/repositories/WorkspaceAccessRepository", () => ({
  WorkspaceAccessRepository: { getHostedPrincipal: mocks.getHostedPrincipal },
}));

describe("resolveHostedContext", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.env)) delete mocks.env[key];
    mocks.getSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "pat@murphyconsulting.us",
        emailVerified: true,
      },
      // Stamped when the session was issued, before the deployment changed.
      session: { activeOrganizationId: "their-old-private-org" },
    });
    mocks.getHostedPrincipal.mockResolvedValue({
      memberId: "member-1",
      role: "owner",
      projectScope: "all",
      projectIds: [],
      delegated: false,
    });
    mocks.getOrCreateDefaultHostedOrganization.mockResolvedValue(SHARED);
    mocks.findFirstOrganizationIdForUser.mockResolvedValue(
      "their-old-private-org",
    );
  });

  it("heals a session pinned to a workspace that predates single-tenant", async () => {
    mocks.env.SINGLE_TENANT = "true";

    const context = await resolveHostedContext(new Headers());

    expect(context.organizationId).toBe(SHARED);
  });

  it("honours the session's workspace when not single-tenant", async () => {
    const context = await resolveHostedContext(new Headers());

    expect(context.organizationId).toBe("their-old-private-org");
    expect(mocks.getOrCreateDefaultHostedOrganization).not.toHaveBeenCalled();
  });
});
