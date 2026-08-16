import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceAccessControlPlugin } from "./auth-workspace-access";

const mocks = vi.hoisted(() => ({
  getSessionFromCtx: vi.fn(),
  findFirstOrganizationIdForUser: vi.fn(),
  getHostedPrincipal: vi.fn(),
}));

vi.mock("better-auth/api", () => ({
  APIError: class APIError extends Error {
    constructor(
      readonly code: string,
      options?: { message?: string },
    ) {
      super(options?.message ?? code);
    }
  },
  createAuthMiddleware: <T>(handler: T) => handler,
  getSessionFromCtx: mocks.getSessionFromCtx,
}));

vi.mock("@/server/auth/repositories/AuthRepository", () => ({
  AuthRepository: {
    findFirstOrganizationIdForUser: mocks.findFirstOrganizationIdForUser,
  },
}));

vi.mock("@/server/auth/repositories/WorkspaceAccessRepository", () => ({
  WorkspaceAccessRepository: {
    getHostedPrincipal: mocks.getHostedPrincipal,
  },
}));

describe("workspace access Better Auth guard", () => {
  beforeEach(() => {
    mocks.getSessionFromCtx.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    mocks.getHostedPrincipal.mockResolvedValue({
      memberId: "member-1",
      role: "client",
      projectScope: "selected",
      projectIds: ["project-1"],
      delegated: false,
    });
  });

  it.each([
    "/organization/list-members",
    "/organization/get-full-organization",
  ])("blocks non-owners from %s", async (path) => {
    const hook = createWorkspaceAccessControlPlugin().hooks.before[0];
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- focused Better Auth hook context stub
    expect(hook.matcher({ path } as never)).toBe(true);
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- focused Better Auth hook context stub
    await expect(hook.handler({ path } as never)).rejects.toThrow(
      "Only the workspace owner can list workspace members.",
    );
  });

  it("allows the owner to use organization member routes", async () => {
    mocks.getHostedPrincipal.mockResolvedValue({
      memberId: "member-owner",
      role: "owner",
      projectScope: "all",
      projectIds: [],
      delegated: false,
    });
    const hook = createWorkspaceAccessControlPlugin().hooks.before[0];
    await expect(
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- focused Better Auth hook context stub
      hook.handler({ path: "/organization/list-members" } as never),
    ).resolves.toBeUndefined();
  });
});
