import type { BillingCustomerContext } from "@/server/billing/subscription";
import { DomainOverviewSnapshotRepository } from "@/server/features/dashboard/repositories/DomainOverviewSnapshotRepository";
import { DomainService } from "@/server/features/domain/services/DomainService";
import { parseDbTimestampMs } from "@/shared/db-timestamps";

// Daily history for the Organic Traffic / Organic Keywords cards.
//
// The numbers themselves come from DomainService, which already owns the
// DataForSEO domain-overview call and its 12-hour R2 cache — this module only
// decides when to ask and writes the answer to a normalized table so a delta can
// be shown tomorrow without paying for yesterday's numbers again.

/** Daily cadence: at most one snapshot per project per day. */
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Project domains are tracked with subdomains: `blog.acme.com` is the same
 * business as `acme.com`, and a split would under-report the site's totals.
 */
const INCLUDE_SUBDOMAINS = true;

function isFresh(capturedAt: string): boolean {
  const ms = parseDbTimestampMs(capturedAt);
  return ms !== null && Date.now() - ms < SNAPSHOT_MAX_AGE_MS;
}

/**
 * Refresh-triggered, idempotent, and re-checked server-side: a second concurrent
 * visit finds a fresh snapshot and pays nothing. On a provider failure with a
 * snapshot already in hand the stale snapshot is kept rather than surfacing an
 * error — the card labels its capture date, so a stale number is honest.
 */
export async function ensureDomainOverviewSnapshot(input: {
  projectId: string;
  domain: string | null;
  locationCode: number;
  languageCode: string;
  billingCustomer: BillingCustomerContext;
}): Promise<void> {
  const { projectId, domain } = input;
  if (!domain) return;

  const [latest] = await DomainOverviewSnapshotRepository.getRecentForProject(
    projectId,
    1,
  );
  const latestMatchesDomain = latest !== undefined && latest.domain === domain;
  if (latestMatchesDomain && isFresh(latest.capturedAt)) return;

  try {
    const overview = await DomainService.getOverview(
      {
        projectId,
        domain,
        includeSubdomains: INCLUDE_SUBDOMAINS,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
      },
      input.billingCustomer,
      { creditFeature: "domain_overview" },
    );

    await DomainOverviewSnapshotRepository.insert({
      projectId,
      domain,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      organicTraffic: overview.organicTraffic,
      organicKeywords: overview.organicKeywords,
      capturedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (latestMatchesDomain) {
      console.error(
        "dashboard: domain overview snapshot refresh failed",
        error,
      );
      return;
    }
    throw error;
  }
}
