import { createServerFn } from "@tanstack/react-start";
import { ProjectService } from "@/server/features/projects/services/ProjectService";
import {
  requireAuthenticatedContext,
  requireProjectContext,
  requireWorkspaceOwner,
} from "@/serverFunctions/middleware";
import {
  archiveProjectSchema,
  createProjectSchema,
  restoreProjectSchema,
  setProjectDomainSchema,
  setProjectMarketSchema,
  updateProjectSchema,
} from "@/types/schemas/projects";
import { z } from "zod";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });

export const getProjects = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) =>
    ProjectService.listAccessibleProjects(
      context.organizationId,
      context.access,
    ),
  );

export const createProject = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .validator(createProjectSchema)
  .handler(async ({ data, context }) =>
    ProjectService.createProject(context.organizationId, data),
  );

export const updateProject = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .validator(updateProjectSchema)
  .handler(async ({ data, context }) =>
    ProjectService.updateProject(context.organizationId, data),
  );

export const setProjectDomain = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .validator(setProjectDomainSchema)
  .handler(async ({ data, context }) =>
    ProjectService.setProjectDomain(context.organizationId, data),
  );

export const setProjectMarket = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .validator(setProjectMarketSchema)
  .handler(async ({ data, context }) =>
    ProjectService.setProjectMarket(context.organizationId, data),
  );

export const archiveProject = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .validator(archiveProjectSchema)
  .handler(async ({ data, context }) =>
    ProjectService.archiveProject(context.organizationId, data),
  );

export const getArchivedProjects = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .handler(async ({ context }) =>
    ProjectService.listArchivedProjects(context.organizationId),
  );

export const restoreProject = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .validator(restoreProjectSchema)
  .handler(async ({ data, context }) =>
    ProjectService.restoreProject(context.organizationId, data),
  );

export const getProjectAccess = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => context.project);
