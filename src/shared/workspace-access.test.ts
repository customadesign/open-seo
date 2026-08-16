import { describe, expect, it } from "vitest";
import {
  canAccessProject,
  canManageWorkspace,
  canUseProjectTools,
  type WorkspacePrincipal,
} from "./workspace-access";

function principal(
  overrides: Partial<WorkspacePrincipal> = {},
): WorkspacePrincipal {
  return {
    memberId: "member-1",
    role: "employee",
    projectScope: "all",
    projectIds: [],
    delegated: false,
    ...overrides,
  };
}

describe("workspace access", () => {
  it("allows all-project employees to use every project", () => {
    const access = principal();

    expect(canAccessProject(access, "project-1")).toBe(true);
    expect(canUseProjectTools(access)).toBe(true);
    expect(canManageWorkspace(access)).toBe(false);
  });

  it("limits selected-project employees to their grants", () => {
    const access = principal({
      projectScope: "selected",
      projectIds: ["project-1"],
    });

    expect(canAccessProject(access, "project-1")).toBe(true);
    expect(canAccessProject(access, "project-2")).toBe(false);
    expect(canUseProjectTools(access)).toBe(true);
  });

  it("keeps client accounts read-only even for an assigned project", () => {
    const access = principal({
      role: "client",
      projectScope: "selected",
      projectIds: ["project-1"],
    });

    expect(canAccessProject(access, "project-1")).toBe(true);
    expect(canUseProjectTools(access)).toBe(false);
    expect(canManageWorkspace(access)).toBe(false);
  });

  it("reserves workspace management for owners", () => {
    expect(canManageWorkspace(principal({ role: "owner" }))).toBe(true);
  });
});
