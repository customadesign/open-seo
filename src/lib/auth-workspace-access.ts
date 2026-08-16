import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { WorkspaceAccessRepository } from "@/server/auth/repositories/WorkspaceAccessRepository";

const API_KEY_PATH_PREFIX = "/api-key/";
const OAUTH_LINK_PATH = "/oauth2/link";
const OWNER_ONLY_ORGANIZATION_PATHS = new Set([
  "/organization/list-members",
  "/organization/get-full-organization",
]);

export function createWorkspaceAccessControlPlugin() {
  return {
    id: "openseo-workspace-access" as const,
    hooks: {
      before: [
        {
          matcher(context) {
            const path = context.path ?? "";
            return (
              path.startsWith(API_KEY_PATH_PREFIX) ||
              path === OAUTH_LINK_PATH ||
              OWNER_ONLY_ORGANIZATION_PATHS.has(path)
            );
          },
          handler: createAuthMiddleware(async (context) => {
            const path = context.path ?? "";
            const session = await getSessionFromCtx(context, {
              disableCookieCache: true,
            });
            if (!session?.user.id) {
              throw new APIError("UNAUTHORIZED");
            }

            const activeOrganizationId =
              typeof session.session.activeOrganizationId === "string"
                ? session.session.activeOrganizationId
                : null;
            const organizationId =
              activeOrganizationId ??
              (await AuthRepository.findFirstOrganizationIdForUser(
                session.user.id,
              ));
            if (!organizationId) throw new APIError("FORBIDDEN");

            const access = await WorkspaceAccessRepository.getHostedPrincipal(
              session.user.id,
              organizationId,
            );
            if (!access) throw new APIError("FORBIDDEN");

            if (
              path.startsWith(API_KEY_PATH_PREFIX) &&
              access.role === "client"
            ) {
              throw new APIError("FORBIDDEN", {
                message: "API keys are unavailable for client accounts.",
              });
            }

            if (path === OAUTH_LINK_PATH && access.role !== "owner") {
              throw new APIError("FORBIDDEN", {
                message: "Only the workspace owner can connect integrations.",
              });
            }

            if (
              OWNER_ONLY_ORGANIZATION_PATHS.has(path) &&
              access.role !== "owner"
            ) {
              throw new APIError("FORBIDDEN", {
                message: "Only the workspace owner can list workspace members.",
              });
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
