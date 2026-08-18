import { buildCacheKey, getCached, setCached } from "@/server/lib/r2-cache";
import { normalizeBacklinksTarget } from "@/server/lib/dataforseo";
import {
  normalizeBacklinksSpamFilterOptions,
  type BacklinksLookupInput,
  type BacklinksSpamFilterOptions,
} from "@/types/schemas/backlinks";
import {
  profileBacklinksOverview,
  profileBacklinksRowsPage,
  profileReferringDomainsPage,
  profileTopPagesPage,
  type BacklinksCache,
  type BacklinksRowsPageServiceInput,
  type ReferringDomainsPageServiceInput,
  type TopPagesPageServiceInput,
} from "@/server/features/backlinks/services/backlinksServiceData";
import {
  bulkApprovalMessages,
  competitorApprovalMessages,
  fingerprintTargets,
  profileBacklinksAnchors,
  profileNewLostTimeseries,
  runBulkAnalysisSnapshot,
} from "@/server/features/backlinks/services/backlinksReportData";
import {
  hasReferringDomainsSnapshot,
  profileReferringDomainsSnapshot,
} from "@/server/features/backlinks/services/backlinksSnapshot";
import { estimateBacklinksBulkCredits } from "@/shared/backlinks";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import type { CreditFeature } from "@/shared/billing-credit-features";
import { BACKLINK_GAP_SNAPSHOT_LIMIT } from "@/shared/gap";

const defaultCache: BacklinksCache = {
  get: getCached,
  set: setCached,
};

type BacklinksPageCacheInput = {
  target: string;
  scope?: "domain" | "page";
  page: number;
  pageSize: number;
  sortField: string;
  sortOrder: string;
  filters: Record<string, unknown>;
  /** Backlinks rows only: DataForSEO result grouping. */
  mode?: string;
};

function createBacklinksService(cache: BacklinksCache = defaultCache) {
  return {
    async profileOverview(
      input: BacklinksLookupInput,
      billingCustomer: BillingCustomerContext,
      // Lets a caller (e.g. onboarding) attribute the spend to its own credit
      // feature. Applied to the DataForSEO calls, not the cache key, so cached
      // results stay shared across callers.
      creditFeature?: CreditFeature,
    ) {
      const cacheKey = await buildCacheKey("backlinks:overview", {
        ...buildTargetCacheInput(input, billingCustomer),
      });

      return profileBacklinksOverview(
        cache,
        cacheKey,
        input,
        billingCustomer,
        creditFeature,
      );
    },
    async profileBacklinksPage(
      input: BacklinksRowsPageServiceInput,
      billingCustomer: BillingCustomerContext,
      options?: BacklinksSpamFilterOptions,
    ) {
      const cacheKey = await buildPageCacheKey(
        "backlinks:rows-page",
        input,
        billingCustomer,
        options,
      );

      return profileBacklinksRowsPage(
        cache,
        cacheKey,
        input,
        billingCustomer,
        options,
      );
    },
    async profileReferringDomainsPage(
      input: ReferringDomainsPageServiceInput,
      billingCustomer: BillingCustomerContext,
      options?: BacklinksSpamFilterOptions,
    ) {
      const cacheKey = await buildPageCacheKey(
        "backlinks:referring-domains-page",
        input,
        billingCustomer,
        options,
      );

      return profileReferringDomainsPage(
        cache,
        cacheKey,
        input,
        billingCustomer,
        options,
      );
    },
    async hasReferringDomainsSnapshot(
      input: { target: string; scope?: "domain" | "page" },
      billingCustomer: BillingCustomerContext,
    ) {
      const cacheKey = await buildCacheKey(
        "backlinks:referring-domains-snapshot",
        {
          ...buildTargetCacheInput(input, billingCustomer),
          limit: String(BACKLINK_GAP_SNAPSHOT_LIMIT),
        },
      );
      return hasReferringDomainsSnapshot(cache, cacheKey);
    },
    async profileReferringDomainsSnapshot(
      input: { target: string; scope?: "domain" | "page" },
      billingCustomer: BillingCustomerContext,
    ) {
      const cacheKey = await buildCacheKey(
        "backlinks:referring-domains-snapshot",
        {
          ...buildTargetCacheInput(input, billingCustomer),
          limit: String(BACKLINK_GAP_SNAPSHOT_LIMIT),
        },
      );
      return profileReferringDomainsSnapshot(
        cache,
        cacheKey,
        input,
        billingCustomer,
      );
    },
    async profileTopPagesPage(
      input: TopPagesPageServiceInput,
      billingCustomer: BillingCustomerContext,
    ) {
      const cacheKey = await buildPageCacheKey(
        "backlinks:top-pages-page",
        input,
        billingCustomer,
      );

      return profileTopPagesPage(cache, cacheKey, input, billingCustomer);
    },
    async profileAnchors(
      input: { target: string; scope?: "domain" | "page" },
      billingCustomer: BillingCustomerContext,
    ) {
      const cacheKey = await buildCacheKey("backlinks:anchors", {
        ...buildTargetCacheInput(input, billingCustomer),
      });
      return profileBacklinksAnchors(cache, cacheKey, input, billingCustomer);
    },
    async profileNewLost(
      input: {
        target: string;
        scope?: "domain" | "page";
        groupRange: "day" | "week";
      },
      billingCustomer: BillingCustomerContext,
    ) {
      const cacheKey = await buildCacheKey("backlinks:new-lost", {
        ...buildTargetCacheInput(input, billingCustomer),
        groupRange: input.groupRange,
      });
      return profileNewLostTimeseries(cache, cacheKey, input, billingCustomer);
    },
    estimateBulkAnalysis() {
      return estimateBacklinksBulkCredits();
    },
    async runBulkAnalysis(
      input: {
        targets: string[];
        locationCode: number;
        languageCode: string;
        maxCostCredits?: number;
      },
      billingCustomer: BillingCustomerContext,
    ) {
      const normalized = input.targets.map((target) =>
        normalizeBacklinksTarget(target),
      );
      const cacheKey = await buildCacheKey("backlinks:bulk", {
        organizationId: billingCustomer.organizationId,
        fingerprint: fingerprintTargets(
          normalized.map((item) => item.apiTarget),
        ),
        locationCode: input.locationCode,
        languageCode: input.languageCode,
      });
      return runBulkAnalysisSnapshot(
        cache,
        cacheKey,
        {
          targets: input.targets,
          locationCode: input.locationCode,
          languageCode: input.languageCode,
          maxCostCredits: input.maxCostCredits,
          ...bulkApprovalMessages(),
        },
        billingCustomer,
      );
    },
    async compareCompetitors(
      input: {
        target: string;
        competitors: string[];
        locationCode: number;
        languageCode: string;
        maxCostCredits?: number;
      },
      billingCustomer: BillingCustomerContext,
    ) {
      const primary = normalizeBacklinksTarget(input.target, {
        scope: "domain",
      });
      const competitors = input.competitors.map((target) =>
        normalizeBacklinksTarget(target, { scope: "domain" }),
      );
      const cacheKey = await buildCacheKey("backlinks:compare", {
        organizationId: billingCustomer.organizationId,
        target: primary.apiTarget,
        fingerprint: fingerprintTargets(
          competitors.map((item) => item.apiTarget),
        ),
        locationCode: input.locationCode,
        languageCode: input.languageCode,
      });
      return runBulkAnalysisSnapshot(
        cache,
        cacheKey,
        {
          targets: [
            primary.apiTarget,
            ...competitors.map((item) => item.apiTarget),
          ],
          locationCode: input.locationCode,
          languageCode: input.languageCode,
          maxCostCredits: input.maxCostCredits,
          primaryTarget: primary.apiTarget,
          ...competitorApprovalMessages(),
        },
        billingCustomer,
      );
    },
  } as const;
}

function buildTargetCacheInput(
  input: BacklinksLookupInput,
  billingCustomer: BillingCustomerContext,
) {
  const normalizedTarget = normalizeBacklinksTarget(input.target, {
    scope: input.scope,
  });

  return {
    organizationId: billingCustomer.organizationId,
    target: normalizedTarget.apiTarget,
    scope: normalizedTarget.scope,
  };
}

async function buildPageCacheKey(
  prefix: string,
  input: BacklinksPageCacheInput,
  billingCustomer: BillingCustomerContext,
  options?: BacklinksSpamFilterOptions,
): Promise<string> {
  const spamFilterOptions = normalizeBacklinksSpamFilterOptions(options);

  return buildCacheKey(prefix, {
    ...buildTargetCacheInput(input, billingCustomer),
    page: input.page,
    pageSize: input.pageSize,
    sortField: input.sortField,
    sortOrder: input.sortOrder,
    filters: input.filters,
    ...(input.mode ? { mode: input.mode } : {}),
    hideSpam: String(spamFilterOptions.hideSpam),
    ...(spamFilterOptions.hideSpam
      ? { spamThreshold: String(spamFilterOptions.spamThreshold) }
      : {}),
  });
}

export const BacklinksService = createBacklinksService();
export { createBacklinksService };
