import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessService } from "./WorkspaceAccessService";

const mocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  findUserIdByEmail: vi.fn(),
  createIssuedMember: vi.fn(),
  listOrganizationMembers: vi.fn(),
  updateMemberAccess: vi.fn(),
  getProjectForOrganization: vi.fn(),
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: mocks.hashPassword,
}));

vi.mock("@/server/auth/repositories/WorkspaceAccessRepository", () => ({
  WorkspaceAccessRepository: {
    findUserIdByEmail: mocks.findUserIdByEmail,
    createIssuedMember: mocks.createIssuedMember,
    listOrganizationMembers: mocks.listOrganizationMembers,
    updateMemberAccess: mocks.updateMemberAccess,
  },
}));

vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

describe("WorkspaceAccessService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUserIdByEmail.mockResolvedValue(null);
    mocks.hashPassword.mockResolvedValue("hashed-password");
    mocks.getProjectForOrganization.mockImplementation(
      (projectId: string, organizationId: string) =>
        Promise.resolve({ id: projectId, organizationId }),
    );
    mocks.createIssuedMember.mockResolvedValue(undefined);
    mocks.updateMemberAccess.mockResolvedValue(undefined);
  });

  it("issues a verified credential-backed client with deduplicated project grants", async () => {
    await expect(
      WorkspaceAccessService.issueAccount("org-1", "owner-1", {
        name: "Casey Client",
        email: "casey@example.com",
        password: "strong password",
        accountType: "client",
        projectScope: "selected",
        projectIds: ["project-1", "project-1"],
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.hashPassword).toHaveBeenCalledWith("strong password");
    expect(mocks.createIssuedMember).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        createdByUserId: "owner-1",
        email: "casey@example.com",
        passwordHash: "hashed-password",
        accountType: "client",
        projectScope: "selected",
        projectIds: ["project-1"],
      }),
    );
  });

  it("rejects an email that already belongs to OpenSEO", async () => {
    mocks.findUserIdByEmail.mockResolvedValue("existing-user");

    await expect(
      WorkspaceAccessService.issueAccount("org-1", "owner-1", {
        name: "Existing",
        email: "existing@example.com",
        password: "strong password",
        accountType: "employee",
        projectScope: "all",
        projectIds: [],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.createIssuedMember).not.toHaveBeenCalled();
  });

  it("refuses to change the workspace owner's access", async () => {
    mocks.listOrganizationMembers.mockResolvedValue([
      {
        memberId: "member-owner",
        userId: "owner-1",
        role: "owner",
      },
    ]);

    await expect(
      WorkspaceAccessService.updateMemberAccess("org-1", "owner-1", {
        memberId: "member-owner",
        accountType: "employee",
        projectScope: "all",
        projectIds: [],
        status: "disabled",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.updateMemberAccess).not.toHaveBeenCalled();
  });

  it("passes deactivation through with the target user for credential revocation", async () => {
    mocks.listOrganizationMembers.mockResolvedValue([
      {
        memberId: "member-2",
        userId: "user-2",
        role: "employee",
      },
    ]);

    await WorkspaceAccessService.updateMemberAccess("org-1", "owner-1", {
      memberId: "member-2",
      accountType: "employee",
      projectScope: "selected",
      projectIds: ["project-1"],
      status: "disabled",
    });

    expect(mocks.updateMemberAccess).toHaveBeenCalledWith({
      memberId: "member-2",
      userId: "user-2",
      status: "disabled",
      createdByUserId: "owner-1",
      accountType: "employee",
      projectScope: "selected",
      projectIds: ["project-1"],
    });
  });
});
