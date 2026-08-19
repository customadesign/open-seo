import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  account,
  apikey,
  member,
  memberAccessProfiles,
  projectMemberAccess,
  session,
  user,
} from "@/db/schema";
import { runBatch } from "@/db/runBatch";
import type { WorkspacePrincipal } from "@/shared/workspace-access";

function hasOwnerRole(role: string) {
  return role.split(",").some((value) => value.trim() === "owner");
}

type ManagedWorkspaceMember = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: "owner" | "employee" | "client";
  projectScope: "all" | "selected";
  status: "active" | "disabled";
  projectIds: string[];
};

async function getHostedPrincipal(
  userId: string,
  organizationId: string,
): Promise<WorkspacePrincipal | null> {
  const [row] = await db
    .select({
      memberId: member.id,
      memberRole: member.role,
      accountType: memberAccessProfiles.accountType,
      projectScope: memberAccessProfiles.projectScope,
      status: memberAccessProfiles.status,
    })
    .from(member)
    .leftJoin(
      memberAccessProfiles,
      eq(memberAccessProfiles.memberId, member.id),
    )
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    )
    .limit(1);

  if (!row || row.status === "disabled") return null;

  if (hasOwnerRole(row.memberRole)) {
    return {
      memberId: row.memberId,
      role: "owner",
      projectScope: "all",
      projectIds: [],
      delegated: false,
    };
  }

  // Existing hosted members predate account issuance. Preserve their current
  // behavior as all-project employees until an owner explicitly narrows them.
  const role = row.accountType === "client" ? "client" : "employee";
  const projectScope =
    role === "client" || row.projectScope === "selected" ? "selected" : "all";
  const grants =
    projectScope === "selected"
      ? await db
          .select({ projectId: projectMemberAccess.projectId })
          .from(projectMemberAccess)
          .where(eq(projectMemberAccess.memberId, row.memberId))
      : [];

  return {
    memberId: row.memberId,
    role,
    projectScope,
    projectIds: grants.map((grant) => grant.projectId),
    delegated: false,
  };
}

/** Just the user ids in a workspace — no access-profile join, because callers
 *  that only need "who is in this workspace" run on hot paths. */
async function listMemberUserIds(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId));

  return rows.map((row) => row.userId);
}

async function listOrganizationMembers(
  organizationId: string,
): Promise<ManagedWorkspaceMember[]> {
  const rows = await db
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      memberRole: member.role,
      accountType: memberAccessProfiles.accountType,
      projectScope: memberAccessProfiles.projectScope,
      status: memberAccessProfiles.status,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      memberAccessProfiles,
      eq(memberAccessProfiles.memberId, member.id),
    )
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(member.createdAt), asc(member.id));

  return Promise.all(
    rows.map(async (row) => {
      const owner = hasOwnerRole(row.memberRole);
      const role = owner
        ? "owner"
        : row.accountType === "client"
          ? "client"
          : "employee";
      const projectScope =
        owner || (!row.projectScope && role === "employee")
          ? "all"
          : role === "client" || row.projectScope === "selected"
            ? "selected"
            : "all";
      const grants =
        projectScope === "selected"
          ? await db
              .select({ projectId: projectMemberAccess.projectId })
              .from(projectMemberAccess)
              .where(eq(projectMemberAccess.memberId, row.memberId))
          : [];

      return {
        memberId: row.memberId,
        userId: row.userId,
        name: row.name,
        email: row.email,
        role,
        projectScope,
        status: owner ? ("active" as const) : (row.status ?? "active"),
        projectIds: grants.map((grant) => grant.projectId),
      };
    }),
  );
}

async function findUserIdByEmail(email: string) {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return row?.id ?? null;
}

async function createIssuedMember(input: {
  organizationId: string;
  createdByUserId: string;
  userId: string;
  memberId: string;
  accountId: string;
  name: string;
  email: string;
  passwordHash: string;
  accountType: "employee" | "client";
  projectScope: "all" | "selected";
  projectIds: string[];
}) {
  const authNow = new Date();
  const appNow = authNow.toISOString();
  await runBatch((tx) => [
    tx.insert(user).values({
      id: input.userId,
      name: input.name,
      email: input.email,
      emailVerified: true,
      createdAt: authNow,
      updatedAt: authNow,
    }),
    tx.insert(account).values({
      id: input.accountId,
      accountId: input.userId,
      providerId: "credential",
      userId: input.userId,
      password: input.passwordHash,
      createdAt: authNow,
      updatedAt: authNow,
    }),
    tx.insert(member).values({
      id: input.memberId,
      organizationId: input.organizationId,
      userId: input.userId,
      role: "member",
      createdAt: authNow,
    }),
    tx.insert(memberAccessProfiles).values({
      memberId: input.memberId,
      accountType: input.accountType,
      projectScope: input.projectScope,
      status: "active",
      createdByUserId: input.createdByUserId,
      createdAt: appNow,
      updatedAt: appNow,
    }),
    ...(input.projectScope === "selected"
      ? [
          tx.insert(projectMemberAccess).values(
            input.projectIds.map((projectId) => ({
              memberId: input.memberId,
              projectId,
              createdAt: appNow,
            })),
          ),
        ]
      : []),
  ]);
}

async function updateMemberAccess(input: {
  memberId: string;
  accountType: "employee" | "client";
  projectScope: "all" | "selected";
  projectIds: string[];
  status: "active" | "disabled";
  createdByUserId: string;
  userId: string;
}) {
  const now = new Date().toISOString();
  await runBatch((tx) => [
    tx
      .delete(projectMemberAccess)
      .where(eq(projectMemberAccess.memberId, input.memberId)),
    tx
      .insert(memberAccessProfiles)
      .values({
        memberId: input.memberId,
        accountType: input.accountType,
        projectScope: input.projectScope,
        status: input.status,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: memberAccessProfiles.memberId,
        set: {
          accountType: input.accountType,
          projectScope: input.projectScope,
          status: input.status,
          updatedAt: now,
        },
      }),
    ...(input.projectScope === "selected"
      ? [
          tx.insert(projectMemberAccess).values(
            input.projectIds.map((projectId) => ({
              memberId: input.memberId,
              projectId,
              createdAt: now,
            })),
          ),
        ]
      : []),
    ...(input.status === "disabled"
      ? [
          tx.delete(session).where(eq(session.userId, input.userId)),
          tx.delete(apikey).where(eq(apikey.referenceId, input.userId)),
        ]
      : []),
  ]);
}

export const WorkspaceAccessRepository = {
  getHostedPrincipal,
  listMemberUserIds,
  listOrganizationMembers,
  findUserIdByEmail,
  createIssuedMember,
  updateMemberAccess,
} as const;
