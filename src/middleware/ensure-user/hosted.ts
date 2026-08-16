import { getAuth, hasHostedAuthConfig } from "@/lib/auth";
import { getActiveOrganizationId } from "@/lib/auth-session";
import { getOrCreateDefaultHostedOrganization } from "@/server/auth/default-hosted-organization";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { WorkspaceAccessRepository } from "@/server/auth/repositories/WorkspaceAccessRepository";
import { AppError } from "@/server/lib/errors";
import type { EnsuredUserContext } from "./types";

async function requireHostedSession(headers: Headers) {
  if (!hasHostedAuthConfig()) {
    throw new AppError(
      "AUTH_CONFIG_MISSING",
      "Missing Better Auth hosted configuration",
    );
  }

  const session = await getAuth().api.getSession({ headers });

  if (!session?.user?.id || !session.user.email) {
    throw new AppError("UNAUTHENTICATED");
  }

  return session;
}

export async function resolveHostedContext(
  headers: Headers,
): Promise<EnsuredUserContext> {
  const session = await requireHostedSession(headers);
  let organizationId = getActiveOrganizationId(session);

  if (!organizationId) {
    organizationId = await AuthRepository.findFirstOrganizationIdForUser(
      session.user.id,
    );
  }

  const authApi = getAuth().api;
  if (!organizationId) {
    organizationId = await getOrCreateDefaultHostedOrganization(
      session.user.id,
      (body) => authApi.createOrganization({ body }),
    );
  }

  let access = await WorkspaceAccessRepository.getHostedPrincipal(
    session.user.id,
    organizationId,
  );

  // A stale active-organization cookie should not strand a valid user, but a
  // disabled member must not be bootstrapped into a fresh workspace.
  if (!access) {
    const membershipOrganizationId =
      await AuthRepository.findFirstOrganizationIdForUser(session.user.id);
    if (!membershipOrganizationId) {
      throw new AppError("UNAUTHENTICATED");
    }
    organizationId = membershipOrganizationId;
    access = await WorkspaceAccessRepository.getHostedPrincipal(
      session.user.id,
      organizationId,
    );
  }

  if (!access) {
    throw new AppError("FORBIDDEN", "This account has been deactivated.");
  }

  if (getActiveOrganizationId(session) !== organizationId) {
    await authApi.setActiveOrganization({
      headers,
      body: { organizationId },
    });
  }

  return {
    userId: session.user.id,
    userEmail: session.user.email,
    emailVerified: session.user.emailVerified ?? false,
    organizationId,
    access,
  };
}
