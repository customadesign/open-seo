import { env } from "cloudflare:workers";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { isSingleTenant } from "@/lib/auth-policy";
import { ensureSharedWorkspaceOrganization } from "./delegated-organization";
import { slugify, toHex } from "./org-slug";

type HostedUser = {
  id: string;
  email: string;
  name?: string | null;
};

type HostedOrganizationCreateInput = {
  name: string;
  slug: string;
  userId: string;
};

type HostedOrganizationCreator = (
  input: HostedOrganizationCreateInput,
) => Promise<{ id: string }>;

function getDefaultHostedOrganizationName(user: HostedUser) {
  const name = user.name?.trim() || user.email.split("@")[0] || "OpenSEO";
  return `${name}'s workspace`;
}

function getDefaultHostedOrganizationSlug(user: HostedUser) {
  const slugSource =
    user.name?.trim() || user.email.split("@")[0] || "workspace";
  const suffix = toHex(user.id).slice(0, 12);
  return `${slugify(slugSource)}-${suffix}`;
}

async function getHostedUser(userId: string) {
  const hostedUser = await AuthRepository.getHostedUser(userId);

  if (!hostedUser?.email) {
    throw new Error("Failed to resolve hosted user for session setup");
  }

  return hostedUser;
}

async function createDefaultHostedOrganization(
  user: HostedUser,
  createOrganization: HostedOrganizationCreator,
) {
  try {
    const createdOrganization = await createOrganization({
      name: getDefaultHostedOrganizationName(user),
      slug: getDefaultHostedOrganizationSlug(user),
      userId: user.id,
    });

    return createdOrganization.id;
  } catch (error) {
    const organizationId = await AuthRepository.findFirstOrganizationIdForUser(
      user.id,
    );

    if (organizationId) {
      return organizationId;
    }

    throw error;
  }
}

export async function getOrCreateDefaultHostedOrganization(
  userId: string,
  createOrganization: HostedOrganizationCreator,
) {
  // A single-tenant deployment has exactly one workspace and everyone works in
  // it, so this resolves to the shared organization rather than minting a
  // per-user one. The branch lives here rather than in the callers because all
  // three entry points — session creation, the request middleware, and MCP
  // API-key auth — must agree on which workspace a user belongs to.
  //
  // Membership is asserted every time: the session gate reads `member`, and a
  // user whose own workspace was folded into the shared one has no row until
  // this creates it.
  if (isSingleTenant(Reflect.get(env, "SINGLE_TENANT") as string | undefined)) {
    const organizationId = await ensureSharedWorkspaceOrganization();
    await AuthRepository.ensureMembership(userId, organizationId, "owner");
    return organizationId;
  }

  const existingOrganizationId =
    await AuthRepository.findFirstOrganizationIdForUser(userId);

  if (existingOrganizationId) {
    return existingOrganizationId;
  }

  const hostedUser = await getHostedUser(userId);
  return createDefaultHostedOrganization(hostedUser, createOrganization);
}
