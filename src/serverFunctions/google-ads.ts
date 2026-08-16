import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { waitUntil } from "cloudflare:workers";
import { z } from "zod";
import { GoogleAdsService } from "@/server/features/google-ads/services/GoogleAdsService";
import { hasGoogleAdsConfig } from "@/server/features/google-ads/services/googleAdsConfig";
import {
  createSelfHostedGoogleAuthorizationUrl,
  GOOGLE_ADS_INTEGRATION,
} from "@/server/features/google/selfHostedOAuth";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { captureServerEvent } from "@/server/lib/posthog";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import {
  requireProjectOwner,
  requireWorkspaceOwner,
} from "@/serverFunctions/middleware";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });
const setCustomerSchema = projectScopedSchema.extend({
  accountId: z.string().min(1),
  customerId: z.string().regex(/^\d{10}$/),
});
const startLinkSchema = z.object({ callbackURL: z.string().min(1) });

export const getGoogleAdsConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectOwner)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    const [connection, currentUserHasGrant, configured] = await Promise.all([
      GoogleAdsService.getConnection(context.projectId),
      GoogleAdsService.userHasGrant(context.userId),
      hasGoogleAdsConfig(),
    ]);
    return {
      connected: Boolean(connection),
      currentUserHasGrant,
      configured,
      customerId: connection?.customerId ?? null,
      customerName: connection?.customerName ?? null,
      currencyCode: connection?.currencyCode ?? null,
      timeZone: connection?.timeZone ?? null,
      connectedByEmail: connection?.connectedAccountEmail ?? null,
    };
  });

export const listGoogleAdsCustomers = createServerFn({ method: "POST" })
  .middleware(requireProjectOwner)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    if (!(await getOptionalEnvValue("GOOGLE_ADS_DEVELOPER_TOKEN"))) {
      return { accounts: [], setupRequired: true as const };
    }
    const [result, connection] = await Promise.all([
      GoogleAdsService.listCustomersForUser(context.userId),
      GoogleAdsService.getConnection(context.projectId),
    ]);
    return {
      setupRequired: false as const,
      accounts: result.accounts.map((grant) => ({
        ...grant,
        customers: grant.customers
          .filter((customer) => !customer.manager)
          .map((customer) => ({
            ...customer,
            isSelected:
              connection?.googleAdsAccountId === grant.accountId &&
              connection.customerId === customer.customerId,
          })),
      })),
    };
  });

export const setGoogleAdsCustomer = createServerFn({ method: "POST" })
  .middleware(requireProjectOwner)
  .validator(setCustomerSchema)
  .handler(async ({ data, context }) => {
    const connection = await GoogleAdsService.setCustomer({
      projectId: context.projectId,
      organizationId: context.organizationId,
      userId: context.userId,
      accountId: data.accountId,
      customerId: data.customerId,
    });
    waitUntil(
      captureServerEvent({
        distinctId: context.userId,
        event: "google_ads:customer_select",
        organizationId: context.organizationId,
        properties: { project_id: context.projectId },
      }),
    );
    return { connected: true as const, customerId: connection.customerId };
  });

export const disconnectGoogleAds = createServerFn({ method: "POST" })
  .middleware(requireProjectOwner)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    await GoogleAdsService.disconnect({
      projectId: context.projectId,
      userId: context.userId,
    });
    return { connected: false as const };
  });

export const startSelfHostedGoogleAdsLink = createServerFn({ method: "POST" })
  .middleware(requireWorkspaceOwner)
  .validator(startLinkSchema)
  .handler(async ({ data, context }) => ({
    url: await createSelfHostedGoogleAuthorizationUrl({
      integration: GOOGLE_ADS_INTEGRATION,
      user: { userId: context.userId, userEmail: context.userEmail },
      callbackURL: data.callbackURL,
      publicOrigin: getPublicOrigin(getRequest()),
    }),
  }));
