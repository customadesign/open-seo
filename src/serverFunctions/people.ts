import { createServerFn } from "@tanstack/react-start";
import {
  requireAuthenticatedContext,
  requireWorkspaceOwner,
} from "./middleware";
import { WorkspaceAccessService } from "@/server/auth/services/WorkspaceAccessService";
import {
  issueAccountSchema,
  updateMemberAccessSchema,
} from "@/types/schemas/people";

export const getCurrentWorkspaceAccess = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => ({
    role: context.access.role,
    projectScope: context.access.projectScope,
    canManageWorkspace: context.access.role === "owner",
    canUseProjectTools: context.access.role !== "client",
  }));

export const getPeople = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .handler(async ({ context }) =>
    WorkspaceAccessService.listPeople(context.organizationId),
  );

export const issueAccount = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .validator(issueAccountSchema)
  .handler(async ({ data, context }) =>
    WorkspaceAccessService.issueAccount(
      context.organizationId,
      context.userId,
      data,
    ),
  );

export const updateMemberAccess = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .validator(updateMemberAccessSchema)
  .handler(async ({ data, context }) =>
    WorkspaceAccessService.updateMemberAccess(
      context.organizationId,
      context.userId,
      data,
    ),
  );
