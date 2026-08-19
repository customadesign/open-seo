import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { AppError } from "@/server/lib/errors";
import { createGa4AdminClient } from "@/server/lib/ga4Client";
import { Ga4AdminApiError, Ga4TokenError } from "@/server/lib/ga4Errors";
import { GA4_OAUTH_PROVIDER_ID } from "@/shared/ga4";
import { resolveGrantUserIds } from "@/server/features/google/grantScope";
import {
  Ga4ConnectionRepository,
  type Ga4Connection,
} from "@/server/features/ga4/repositories/Ga4ConnectionRepository";

async function getConnection(projectId: string): Promise<Ga4Connection | null> {
  return Ga4ConnectionRepository.getByProjectId(projectId);
}

/** Grants the caller may use, each carrying the user it belongs to — tokens are
 *  minted against the grant's owner, which on a shared workspace is often not
 *  the person making the request. */
async function listGrantsForUser(userId: string, organizationId: string) {
  const grantUserIds = await resolveGrantUserIds(userId, organizationId);
  return db
    .select({
      id: account.id,
      accountId: account.accountId,
      userId: account.userId,
    })
    .from(account)
    .where(
      and(
        inArray(account.userId, grantUserIds),
        eq(account.providerId, GA4_OAUTH_PROVIDER_ID),
      ),
    );
}

async function userHasGrant(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const grants = await listGrantsForUser(userId, organizationId);
  return grants.length > 0;
}

function requiresReconnect(error: unknown): boolean {
  return (
    error instanceof Ga4TokenError ||
    (error instanceof Ga4AdminApiError && error.status === 401)
  );
}

async function listPropertiesForUserWithGrantStatus(
  userId: string,
  organizationId: string,
) {
  const grants = await listGrantsForUser(userId, organizationId);
  const accounts = await Promise.all(
    grants.map(async (grant) => {
      const client = createGa4AdminClient({
        userId: grant.userId,
        ga4AccountId: grant.accountId,
      });
      try {
        const properties = await client.listProperties();
        let email: string | null = null;
        try {
          email = await client.getUserInfoEmail();
        } catch {
          email = null;
        }
        return {
          accountId: grant.accountId,
          email,
          requiresReconnect: false,
          propertiesUnavailable: false,
          properties,
        };
      } catch (error) {
        const reconnect = requiresReconnect(error);
        if (!reconnect) {
          console.error("ga4.property_discovery_failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            status:
              error instanceof Ga4AdminApiError ? error.status : undefined,
          });
        }
        return {
          accountId: grant.accountId,
          email: null,
          requiresReconnect: reconnect,
          propertiesUnavailable: !reconnect,
          properties: [],
        };
      }
    }),
  );
  return { accounts };
}

async function setProperty(input: {
  projectId: string;
  organizationId: string;
  propertyId: string;
  accountId: string;
  userId: string;
}): Promise<Ga4Connection> {
  const grants = await listGrantsForUser(input.userId, input.organizationId);
  const grant = grants.find((row) => row.accountId === input.accountId);
  if (!grant) {
    throw new AppError(
      "NOT_FOUND",
      "That Google account isn't connected to your OpenSEO account.",
    );
  }

  const client = createGa4AdminClient({
    userId: grant.userId,
    ga4AccountId: input.accountId,
  });
  const properties = await client.listProperties();
  if (
    !properties.some((property) => property.propertyId === input.propertyId)
  ) {
    throw new AppError(
      "NOT_FOUND",
      "That Google Analytics property isn't available on your connected Google account.",
    );
  }

  const property = await client.getProperty(input.propertyId);
  let connectedAccountEmail: string | null = null;
  try {
    connectedAccountEmail = await client.getUserInfoEmail();
  } catch {
    connectedAccountEmail = null;
  }

  return Ga4ConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    propertyId: property.name,
    propertyDisplayName: property.displayName,
    propertyTimeZone: property.timeZone,
    propertyCurrencyCode: property.currencyCode,
    connectedByUserId: grant.userId,
    ga4AccountId: input.accountId,
    connectedAccountEmail,
  });
}

async function unlinkUserGrant(
  userId: string,
  ga4AccountId: string,
): Promise<void> {
  await db
    .delete(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, GA4_OAUTH_PROVIDER_ID),
        eq(account.accountId, ga4AccountId),
      ),
    );
}

async function disconnect(input: {
  projectId: string;
  userId: string;
}): Promise<void> {
  const connection = await Ga4ConnectionRepository.getByProjectId(
    input.projectId,
  );
  await Ga4ConnectionRepository.deleteByProjectId(input.projectId);
  if (
    connection?.ga4AccountId &&
    connection.connectedByUserId === input.userId
  ) {
    const stillUsed = await Ga4ConnectionRepository.existsForConnectorAccount(
      input.userId,
      connection.ga4AccountId,
    );
    if (!stillUsed) {
      await unlinkUserGrant(input.userId, connection.ga4AccountId);
    }
  }
}

export const Ga4Service = {
  getConnection,
  userHasGrant,
  listPropertiesForUserWithGrantStatus,
  setProperty,
  disconnect,
};
