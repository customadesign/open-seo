import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { member, organization, user as authUser } from "@/db/schema";
import { randomUUID } from "node:crypto";

type DelegatedOrganizationInput = {
  id: string;
  name: string;
  slug: string;
};

async function upsertDelegatedOrganization(input: DelegatedOrganizationInput) {
  await db
    .insert(organization)
    .values({
      id: input.id,
      name: input.name,
      slug: input.slug,
      logo: null,
      createdAt: new Date(),
      metadata: null,
    })
    .onConflictDoUpdate({
      target: organization.id,
      set: {
        name: input.name,
        slug: input.slug,
      },
    });
}

// Idempotent: `member` has a unique (organization_id, user_id) index, so a
// concurrent second call is a no-op rather than a duplicate or a failure.
async function ensureMembership(
  userId: string,
  organizationId: string,
  role: string,
) {
  await db
    .insert(member)
    .values({
      id: randomUUID(),
      organizationId,
      userId,
      role,
      createdAt: new Date(),
    })
    .onConflictDoNothing({
      target: [member.organizationId, member.userId],
    });
}

async function findFirstOrganizationIdForUser(userId: string) {
  const [existingMembership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt))
    .limit(1);

  return existingMembership?.organizationId ?? null;
}

async function getHostedUser(userId: string) {
  return db.query.user.findFirst({
    columns: {
      id: true,
      email: true,
      name: true,
    },
    where: eq(authUser.id, userId),
  });
}

export const AuthRepository = {
  upsertDelegatedOrganization,
  ensureMembership,
  findFirstOrganizationIdForUser,
  getHostedUser,
} as const;
