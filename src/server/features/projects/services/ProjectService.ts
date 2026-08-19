import {
  archiveProject,
  createProject,
  getProjectForOrganization,
  listArchivedProjects,
  listAccessibleProjects,
  listProjects,
  listProjectsEnsuringOne,
  restoreProject,
  setProjectDomain,
  setProjectMarket,
  updateProject,
} from "@/server/features/projects/services/projects";

export const ProjectService = {
  listProjects,
  listAccessibleProjects,
  listProjectsEnsuringOne,
  createProject,
  updateProject,
  setProjectDomain,
  setProjectMarket,
  archiveProject,
  restoreProject,
  listArchivedProjects,
  getProjectForOrganization,
} as const;
