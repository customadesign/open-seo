import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGrantUserIds } from "./grantScope";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  listMemberUserIds: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/server/auth/repositories/WorkspaceAccessRepository", () => ({
  WorkspaceAccessRepository: { listMemberUserIds: mocks.listMemberUserIds },
}));

describe("resolveGrantUserIds", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.env)) delete mocks.env[key];
    mocks.listMemberUserIds.mockResolvedValue([
      "local-admin",
      "user-1",
      "user-2",
    ]);
  });

  it("keeps grants personal on a multi-tenant deployment", async () => {
    await expect(resolveGrantUserIds("user-1", "org-1")).resolves.toEqual([
      "user-1",
    ]);
    expect(mocks.listMemberUserIds).not.toHaveBeenCalled();
  });

  it("shares grants across the workspace when single-tenant", async () => {
    mocks.env.SINGLE_TENANT = "true";

    // `local-admin` holds the grants migrated off local_noauth; a signed-in
    // colleague must be able to use them.
    await expect(resolveGrantUserIds("user-1", "org-1")).resolves.toContain(
      "local-admin",
    );
  });

  it("still includes the caller if the workspace lookup comes back empty", async () => {
    mocks.env.SINGLE_TENANT = "true";
    mocks.listMemberUserIds.mockResolvedValue([]);

    await expect(resolveGrantUserIds("user-1", "org-1")).resolves.toEqual([
      "user-1",
    ]);
  });
});
