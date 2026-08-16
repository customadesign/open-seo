export type WorkspaceRole = "owner" | "employee" | "client";
export type ProjectAccessScope = "all" | "selected";

export type WorkspacePrincipal = {
  memberId: string | null;
  role: WorkspaceRole;
  projectScope: ProjectAccessScope;
  projectIds: string[];
  delegated: boolean;
};

export function canAccessProject(
  principal: WorkspacePrincipal,
  projectId: string,
) {
  return (
    principal.projectScope === "all" || principal.projectIds.includes(projectId)
  );
}

export function canUseProjectTools(principal: WorkspacePrincipal) {
  return principal.role !== "client";
}

export function canManageWorkspace(principal: WorkspacePrincipal) {
  return principal.role === "owner";
}
