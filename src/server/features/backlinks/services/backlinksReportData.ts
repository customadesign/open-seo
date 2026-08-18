import type { BillingCustomerContext } from "@/server/billing/subscription";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseo";
import { AppError } from "@/server/lib/errors";
import {
  COMMERCIAL_ANCHOR_SHARE_THRESHOLD,
  classifyAnchorText,
  estimateBacklinksBulkCredits,
  backlinksBulkApprovalRequiredError,
  backlinksBulkCostApprovalError,
  backlinksCompetitorApprovalRequiredError,
  backlinksCompetitorCostApprovalError,
} from "@/shared/backlinks";
import { MAX_BACKLINKS_REPORT_ROWS } from "@/types/schemas/backlinks";
import type { BacklinksCache } from "@/server/features/backlinks/services/backlinksServiceData";
import {
  backlinksAnchorsResultSchema,
  backlinksBulkResultSchema,
  backlinksNewLostResultSchema,
  type BacklinksAnchorsResult,
  type BacklinksBulkResult,
  type BacklinksNewLostResult,
} from "@/server/features/backlinks/services/backlinksReportSchema";

const BACKLINKS_REPORT_TTL_SECONDS = 6 * 60 * 60;

export async function profileBacklinksAnchors(
  cache: BacklinksCache,
  cacheKey: string,
  input: { target: string; scope?: "domain" | "page" },
  billingCustomer: BillingCustomerContext,
): Promise<BacklinksAnchorsResult> {
  const cached = backlinksAnchorsResultSchema.safeParse(
    await cache.get(cacheKey),
  );
  if (cached.success) return cached.data;

  const normalizedTarget = normalizeBacklinksTarget(input.target, {
    scope: input.scope,
  });
  const dataforseo = createDataforseoClient(billingCustomer);
  const response = await dataforseo.backlinks.anchors({
    target: normalizedTarget.apiTarget,
    limit: MAX_BACKLINKS_REPORT_ROWS,
    orderBy: ["backlinks,desc"],
  });

  const totalBacklinks = response.items.reduce(
    (sum, item) => sum + (item.backlinks ?? 0),
    0,
  );
  const rows = response.items.map((item) => {
    const backlinks = item.backlinks ?? 0;
    const share = totalBacklinks > 0 ? backlinks / totalBacklinks : 0;
    const kind = classifyAnchorText(item.anchor, normalizedTarget.apiTarget);
    return {
      anchor: item.anchor ?? null,
      referringDomains: item.referring_domains ?? null,
      backlinks: item.backlinks ?? null,
      referringPages: item.referring_pages ?? null,
      rank: item.rank ?? null,
      spamScore: item.backlinks_spam_score ?? null,
      firstSeen: item.first_seen ?? null,
      share,
      kind,
      concentrated:
        kind === "commercial" && share >= COMMERCIAL_ANCHOR_SHARE_THRESHOLD,
    };
  });

  const result: BacklinksAnchorsResult = {
    target: normalizedTarget.apiTarget,
    displayTarget: normalizedTarget.displayTarget,
    scope: normalizedTarget.scope,
    rows,
    totalCount: response.totalCount,
    totalBacklinks,
    concentratedAnchors: rows.flatMap((row) =>
      row.concentrated && row.anchor ? [row.anchor] : [],
    ),
    fetchedAt: new Date().toISOString(),
  };
  await writeReportCache(cache, cacheKey, result);
  return result;
}

export async function profileNewLostTimeseries(
  cache: BacklinksCache,
  cacheKey: string,
  input: {
    target: string;
    scope?: "domain" | "page";
    groupRange: "day" | "week";
  },
  billingCustomer: BillingCustomerContext,
): Promise<BacklinksNewLostResult> {
  const cached = backlinksNewLostResultSchema.safeParse(
    await cache.get(cacheKey),
  );
  if (cached.success) return cached.data;

  const normalizedTarget = normalizeBacklinksTarget(input.target, {
    scope: input.scope,
  });
  if (normalizedTarget.scope !== "domain") {
    throw new AppError(
      "VALIDATION_ERROR",
      "New and lost timeseries is available for domain lookups only.",
    );
  }

  const now = new Date();
  const dateRange = buildReportDateRange(now, 6);
  const dataforseo = createDataforseoClient(billingCustomer);
  const items = await dataforseo.backlinks.timeseriesNewLost({
    target: normalizedTarget.apiTarget,
    ...dateRange,
    groupRange: input.groupRange,
  });

  const result: BacklinksNewLostResult = {
    target: normalizedTarget.apiTarget,
    displayTarget: normalizedTarget.displayTarget,
    groupRange: input.groupRange,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    rows: items
      .map((item) => ({
        date: item.date ? item.date.slice(0, 10) : null,
        newBacklinks: item.new_backlinks ?? null,
        lostBacklinks: item.lost_backlinks ?? null,
        newReferringDomains: item.new_referring_domains ?? null,
        lostReferringDomains: item.lost_referring_domains ?? null,
      }))
      .filter(
        (item): item is typeof item & { date: string } => item.date != null,
      ),
    fetchedAt: now.toISOString(),
  };
  await writeReportCache(cache, cacheKey, result);
  return result;
}

export async function runBulkAnalysisSnapshot(
  cache: BacklinksCache,
  cacheKey: string,
  input: {
    targets: string[];
    locationCode: number;
    languageCode: string;
    maxCostCredits?: number;
    approvalRequiredError: (costCredits: number) => string;
    approvalExceededError: (
      costCredits: number,
      maxCostCredits: number,
    ) => string;
    primaryTarget?: string;
  },
  billingCustomer: BillingCustomerContext,
): Promise<BacklinksBulkResult> {
  const cached = backlinksBulkResultSchema.safeParse(await cache.get(cacheKey));
  if (cached.success) {
    return { ...cached.data, fromCache: true };
  }

  const estimate = estimateBacklinksBulkCredits();
  if (input.maxCostCredits == null || input.maxCostCredits <= 0) {
    throw new AppError(
      "VALIDATION_ERROR",
      input.approvalRequiredError(estimate.costCredits),
    );
  }
  if (estimate.costCredits > input.maxCostCredits) {
    throw new AppError(
      "VALIDATION_ERROR",
      input.approvalExceededError(estimate.costCredits, input.maxCostCredits),
    );
  }

  const normalized = input.targets.map((target) =>
    normalizeBacklinksTarget(target),
  );
  const apiTargets = normalized.map((item) => item.apiTarget);
  const dataforseo = createDataforseoClient(billingCustomer);
  const [ranks, backlinks, referringDomains, traffic] = await Promise.all([
    dataforseo.backlinks.bulkRanks({ targets: apiTargets }),
    dataforseo.backlinks.bulkBacklinks({ targets: apiTargets }),
    dataforseo.backlinks.bulkReferringDomains({ targets: apiTargets }),
    dataforseo.labs.bulkTrafficEstimation({
      targets: apiTargets,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      creditFeature: "backlinks",
    }),
  ]);

  const rankByTarget = indexByTarget(ranks, (item) => item.rank ?? null);
  const backlinksByTarget = indexByTarget(
    backlinks,
    (item) => item.backlinks ?? null,
  );
  const referringByTarget = indexByTarget(
    referringDomains,
    (item) => item.referring_domains ?? null,
  );
  const trafficByTarget = new Map<string, number | null>();
  for (const item of traffic) {
    if (!item.target) continue;
    const etv = item.metrics?.organic?.etv;
    trafficByTarget.set(
      normalizeLookupTarget(item.target),
      etv == null ? null : Math.round(etv),
    );
  }

  const primaryLookup = input.primaryTarget
    ? normalizeLookupTarget(input.primaryTarget)
    : null;
  const result: BacklinksBulkResult = {
    rows: normalized.map((item) => {
      const key = normalizeLookupTarget(item.apiTarget);
      return {
        target: item.apiTarget,
        displayTarget: item.displayTarget,
        authorityScore: rankByTarget.get(key) ?? null,
        referringDomains: referringByTarget.get(key) ?? null,
        backlinks: backlinksByTarget.get(key) ?? null,
        organicTraffic: trafficByTarget.get(key) ?? null,
        isPrimary: primaryLookup != null && key === primaryLookup,
      };
    }),
    fetchedAt: new Date().toISOString(),
    fromCache: false,
  };
  await writeReportCache(cache, cacheKey, result);
  return result;
}

export function competitorApprovalMessages() {
  return {
    approvalRequiredError: backlinksCompetitorApprovalRequiredError,
    approvalExceededError: backlinksCompetitorCostApprovalError,
  };
}

export function bulkApprovalMessages() {
  return {
    approvalRequiredError: backlinksBulkApprovalRequiredError,
    approvalExceededError: backlinksBulkCostApprovalError,
  };
}

export function fingerprintTargets(targets: string[]) {
  return targets
    .map((target) => normalizeLookupTarget(target))
    .toSorted()
    .join("\n");
}

function indexByTarget<T extends { target?: string | null }>(
  items: T[],
  read: (item: T) => number | null,
) {
  const map = new Map<string, number | null>();
  for (const item of items) {
    if (!item.target) continue;
    map.set(normalizeLookupTarget(item.target), read(item));
  }
  return map;
}

function normalizeLookupTarget(target: string) {
  return target
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
}

function buildReportDateRange(now: Date, months: number) {
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dateToUtc = new Date(todayUtc);
  dateToUtc.setUTCDate(dateToUtc.getUTCDate() - 1);
  const dateFromUtc = new Date(dateToUtc);
  dateFromUtc.setUTCMonth(dateFromUtc.getUTCMonth() - months);
  return {
    dateFrom: dateFromUtc.toISOString().slice(0, 10),
    dateTo: dateToUtc.toISOString().slice(0, 10),
  };
}

async function writeReportCache(
  cache: BacklinksCache,
  key: string,
  data: unknown,
) {
  await cache
    .set(key, data, BACKLINKS_REPORT_TTL_SECONDS)
    .catch((error: unknown) => {
      console.error("backlinks.report-cache-write failed:", error);
    });
}
