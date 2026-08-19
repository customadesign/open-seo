import { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  createDataforseoClient,
  normalizeBacklinksTarget,
} from "@/server/lib/dataforseo";
import { BACKLINK_GAP_SNAPSHOT_LIMIT } from "@/shared/gap";
import {
  cacheValue,
  mapReferringDomainsRows,
  type BacklinksCache,
} from "@/server/features/backlinks/services/backlinksServiceData";

const BACKLINKS_SNAPSHOT_TTL_SECONDS = 6 * 60 * 60;

const referringDomainsSnapshotSchema = z.object({
  domain: z.string(),
  rows: z.array(
    z.object({
      domain: z.string().nullable(),
      backlinks: z.number().nullable(),
      referringPages: z.number().nullable(),
      rank: z.number().nullable(),
      spamScore: z.number().nullable(),
      firstSeen: z.string().nullable(),
      brokenBacklinks: z.number().nullable(),
      brokenPages: z.number().nullable(),
    }),
  ),
  fetchedAt: z.string(),
  fromCache: z.boolean(),
});

export type ReferringDomainsSnapshot = z.infer<
  typeof referringDomainsSnapshotSchema
>;

export async function hasReferringDomainsSnapshot(
  cache: BacklinksCache,
  cacheKey: string,
): Promise<boolean> {
  const cached = referringDomainsSnapshotSchema.safeParse(
    await cache.get(cacheKey),
  );
  return cached.success;
}

export async function profileReferringDomainsSnapshot(
  cache: BacklinksCache,
  cacheKey: string,
  input: { target: string; scope?: "domain" | "page" },
  billingCustomer: BillingCustomerContext,
): Promise<ReferringDomainsSnapshot> {
  const cached = referringDomainsSnapshotSchema.safeParse(
    await cache.get(cacheKey),
  );
  if (cached.success) {
    return { ...cached.data, fromCache: true };
  }

  const dataforseo = createDataforseoClient(billingCustomer);
  const normalized = normalizeBacklinksTarget(input.target, {
    scope: input.scope,
  });
  const response = await dataforseo.backlinks.referringDomains({
    target: normalized.apiTarget,
    limit: BACKLINK_GAP_SNAPSHOT_LIMIT,
    orderBy: ["rank,desc"],
  });

  const result: ReferringDomainsSnapshot = {
    domain: normalized.apiTarget,
    rows: mapReferringDomainsRows(response.items),
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  };
  await cacheValue(cache, cacheKey, result, BACKLINKS_SNAPSHOT_TTL_SECONDS);
  return result;
}
