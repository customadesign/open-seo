import { env } from "cloudflare:workers";
import { isSingleTenant } from "@/lib/auth-policy";
import { WorkspaceAccessRepository } from "@/server/auth/repositories/WorkspaceAccessRepository";

/**
 * Whose Google grants count for a request.
 *
 * A multi-tenant deployment keeps grants strictly personal: one customer's
 * Search Console tokens must never be reachable from another's session. A
 * single-tenant deployment is the opposite case — one company sharing one
 * workspace, where a connection made by a colleague (or, after migrating off
 * local_noauth, by the retired `local-admin` user) has to stay usable by
 * everyone. There the workspace, not the individual, owns the connection.
 *
 * Always includes the caller, so a workspace lookup that returns nothing still
 * degrades to personal-grants-only rather than to no grants at all.
 */
export async function resolveGrantUserIds(
  userId: string,
  organizationId: string,
): Promise<string[]> {
  if (
    !isSingleTenant(Reflect.get(env, "SINGLE_TENANT") as string | undefined)
  ) {
    return [userId];
  }

  const memberIds =
    await WorkspaceAccessRepository.listMemberUserIds(organizationId);

  return memberIds.includes(userId) ? memberIds : [userId, ...memberIds];
}
