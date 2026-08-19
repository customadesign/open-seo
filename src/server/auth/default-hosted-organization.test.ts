import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOrCreateDefaultHostedOrganization } from "./default-hosted-organization";
import { SHARED_WORKSPACE_ORGANIZATION_ID } from "./delegated-organization";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  findFirstOrganizationIdForUser: vi.fn(),
  ensureMembership: vi.fn(),
  getHostedUser: vi.fn(),
  upsertDelegatedOrganization: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));

vi.mock("@/server/auth/repositories/AuthRepository", () => ({
  AuthRepository: {
    findFirstOrganizationIdForUser: mocks.findFirstOrganizationIdForUser,
    ensureMembership: mocks.ensureMembership,
    getHostedUser: mocks.getHostedUser,
    upsertDelegatedOrganization: mocks.upsertDelegatedOrganization,
  },
}));

const createOrganization = vi.fn();

describe("getOrCreateDefaultHostedOrganization", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.env)) delete mocks.env[key];
    mocks.findFirstOrganizationIdForUser.mockResolvedValue(null);
    mocks.getHostedUser.mockResolvedValue({
      id: "user-1",
      email: "pat@murphyconsulting.us",
      name: null,
    });
    createOrganization.mockResolvedValue({ id: "org-new" });
  });

  it("gives every user the same workspace when single-tenant", async () => {
    mocks.env.SINGLE_TENANT = "true";
    // A user who already owns a private workspace must still be moved onto the
    // shared one, or folding their old workspace in would strand them.
    mocks.findFirstOrganizationIdForUser.mockResolvedValue("their-own-org");

    await expect(
      getOrCreateDefaultHostedOrganization("user-1", createOrganization),
    ).resolves.toBe(SHARED_WORKSPACE_ORGANIZATION_ID);
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it("asserts membership so the session gate can find a member row", async () => {
    mocks.env.SINGLE_TENANT = "true";

    await getOrCreateDefaultHostedOrganization("user-1", createOrganization);

    expect(mocks.ensureMembership).toHaveBeenCalledWith(
      "user-1",
      SHARED_WORKSPACE_ORGANIZATION_ID,
      "owner",
    );
  });

  it("keeps per-user workspaces when not single-tenant", async () => {
    await expect(
      getOrCreateDefaultHostedOrganization("user-1", createOrganization),
    ).resolves.toBe("org-new");
    expect(mocks.ensureMembership).not.toHaveBeenCalled();
  });
});
