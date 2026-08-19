import type { ToolAuthContext } from "@/server/mcp/context";
import type { WorkspacePrincipal } from "@/shared/workspace-access";

const delegatedOwner: WorkspacePrincipal = {
  memberId: null,
  role: "owner",
  projectScope: "all",
  projectIds: [],
  delegated: true,
};

export async function resolveMcpWorkspacePrincipal(
  auth: ToolAuthContext,
): Promise<WorkspacePrincipal | null> {
  if (auth.delegated) return delegatedOwner;

  // Self-hosted tools never need the hosted database module. Keeping this
  // import on the hosted path also lets local MCP tests run outside Workers.
  const { WorkspaceAccessRepository } =
    await import("@/server/auth/repositories/WorkspaceAccessRepository");
  return WorkspaceAccessRepository.getHostedPrincipal(
    auth.userId,
    auth.organizationId,
  );
}
