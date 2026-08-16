import { hashPassword } from "better-auth/crypto";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { WorkspaceAccessRepository } from "@/server/auth/repositories/WorkspaceAccessRepository";
import { AppError } from "@/server/lib/errors";
import type {
  IssueAccountInput,
  UpdateMemberAccessInput,
} from "@/types/schemas/people";

function normalizeAccess(input: {
  accountType: "employee" | "client";
  projectScope: "all" | "selected";
  projectIds: string[];
}) {
  const projectScope =
    input.accountType === "client" ? ("selected" as const) : input.projectScope;
  return {
    accountType: input.accountType,
    projectScope,
    projectIds:
      projectScope === "selected" ? [...new Set(input.projectIds)] : [],
  };
}

async function validateProjects(organizationId: string, projectIds: string[]) {
  await Promise.all(
    projectIds.map(async (projectId) => {
      const project = await ProjectRepository.getProjectForOrganization(
        projectId,
        organizationId,
      );
      if (!project) throw new AppError("NOT_FOUND");
    }),
  );
}

async function listPeople(organizationId: string) {
  return WorkspaceAccessRepository.listOrganizationMembers(organizationId);
}

async function issueAccount(
  organizationId: string,
  createdByUserId: string,
  input: IssueAccountInput,
) {
  if (await WorkspaceAccessRepository.findUserIdByEmail(input.email)) {
    throw new AppError(
      "CONFLICT",
      "That email already belongs to an OpenSEO account.",
    );
  }

  const access = normalizeAccess(input);
  await validateProjects(organizationId, access.projectIds);
  const passwordHash = await hashPassword(input.password);

  try {
    await WorkspaceAccessRepository.createIssuedMember({
      organizationId,
      createdByUserId,
      userId: crypto.randomUUID(),
      memberId: crypto.randomUUID(),
      accountId: crypto.randomUUID(),
      name: input.name,
      email: input.email,
      passwordHash,
      ...access,
    });
  } catch (error) {
    if (await WorkspaceAccessRepository.findUserIdByEmail(input.email)) {
      throw new AppError(
        "CONFLICT",
        "That email already belongs to an OpenSEO account.",
      );
    }
    throw error;
  }

  return { success: true };
}

async function updateMemberAccess(
  organizationId: string,
  updatedByUserId: string,
  input: UpdateMemberAccessInput,
) {
  const people =
    await WorkspaceAccessRepository.listOrganizationMembers(organizationId);
  const target = people.find((person) => person.memberId === input.memberId);
  if (!target) throw new AppError("NOT_FOUND");
  if (target.role === "owner") {
    throw new AppError("FORBIDDEN", "Owner access cannot be changed here.");
  }

  const access = normalizeAccess(input);
  await validateProjects(organizationId, access.projectIds);
  await WorkspaceAccessRepository.updateMemberAccess({
    memberId: target.memberId,
    userId: target.userId,
    status: input.status,
    createdByUserId: updatedByUserId,
    ...access,
  });
  return { success: true };
}

export const WorkspaceAccessService = {
  listPeople,
  issueAccount,
  updateMemberAccess,
} as const;
