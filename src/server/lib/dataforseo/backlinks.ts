/* eslint-disable max-lines -- one module owns every Backlinks API fetcher */
import { z } from "zod";
import {
  BacklinksAnchorsLiveRequestInfo,
  BacklinksBacklinksLiveRequestInfo,
  BacklinksBulkBacklinksLiveRequestInfo,
  BacklinksBulkRanksLiveRequestInfo,
  BacklinksBulkReferringDomainsLiveRequestInfo,
  BacklinksDomainPagesSummaryLiveRequestInfo,
  BacklinksHistoryLiveRequestInfo,
  BacklinksReferringDomainsLiveRequestInfo,
  BacklinksSummaryLiveRequestInfo,
  BacklinksTimeseriesNewLostSummaryLiveRequestInfo,
} from "dataforseo-client";
import {
  normalizeBacklinksSpamFilterOptions,
  type BacklinksSpamFilterOptions,
} from "@/types/schemas/backlinks";
import { createDataforseoBillingClassifier } from "@/server/lib/dataforseoBillingClassification";
import { AppError } from "@/server/lib/errors";
import { backlinksApi } from "@/server/lib/dataforseo/core";
import {
  assertOk,
  buildTaskBilling,
  parseTaskItems,
  parseTaskTotalCount,
  type DataforseoApiResponse,
} from "@/server/lib/dataforseo/envelope";

type BacklinksRequest = { target: string };
type BacklinksListRequest = BacklinksRequest &
  BacklinksSpamFilterOptions & {
    limit?: number;
    offset?: number;
    /** DataForSEO order_by entries, e.g. ["rank,desc"]. */
    orderBy?: string[];
    /** Pre-built DataForSEO filter expressions, already joined with and/or. */
    filters?: unknown[];
    /** Result grouping (backlinks list only): "one_per_domain" | "as_is". */
    mode?: string;
  };
type BacklinksTimeseriesRequest = {
  target: string;
  dateFrom: string;
  dateTo: string;
};
type BacklinksNewLostTimeseriesRequest = BacklinksTimeseriesRequest & {
  groupRange?: "day" | "week";
};
type BacklinksBulkTargetsRequest = {
  targets: string[];
};

const classifyBacklinksError = createDataforseoBillingClassifier({
  pathPrefix: "/backlinks/",
  billingIssueCode: "BACKLINKS_BILLING_ISSUE",
  billingIssueMessage:
    "The connected DataForSEO account has a billing or balance issue",
});

// DataForSEO ships both the misspelled (`*_reffering_*`) and corrected keys; we
// accept both via passthrough so callers can read whichever is present.
export const backlinksSummaryItemSchema = z
  .object({
    target: z.string().optional(),
    rank: z.number().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    referring_pages: z.number().nullable().optional(),
    referring_domains: z.number().nullable().optional(),
    broken_backlinks: z.number().nullable().optional(),
    broken_pages: z.number().nullable().optional(),
    new_backlinks: z.number().nullable().optional(),
    lost_backlinks: z.number().nullable().optional(),
    new_reffering_domains: z.number().nullable().optional(),
    lost_reffering_domains: z.number().nullable().optional(),
    new_referring_domains: z.number().nullable().optional(),
    lost_referring_domains: z.number().nullable().optional(),
    backlinks_spam_score: z.number().nullable().optional(),
    info: z
      .object({ target_spam_score: z.number().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export const backlinksItemSchema = z
  .object({
    domain_from: z.string().nullable().optional(),
    url_from: z.string().nullable().optional(),
    url_to: z.string().nullable().optional(),
    anchor: z.string().nullable().optional(),
    item_type: z.string().nullable().optional(),
    dofollow: z.boolean().nullable().optional(),
    rank: z.number().nullable().optional(),
    domain_from_rank: z.number().nullable().optional(),
    page_from_rank: z.number().nullable().optional(),
    backlinks_spam_score: z.number().nullable().optional(),
    backlink_spam_score: z.number().nullable().optional(),
    first_seen: z.string().nullable().optional(),
    last_visited: z.string().nullable().optional(),
    lost_date: z.string().nullable().optional(),
    is_new: z.boolean().nullable().optional(),
    is_lost: z.boolean().nullable().optional(),
    is_broken: z.boolean().nullable().optional(),
    links_count: z.number().nullable().optional(),
    domain_from_ip: z.string().nullable().optional(),
    page_from_language: z.string().nullable().optional(),
    semantic_location: z.string().nullable().optional(),
    tld_from: z.string().nullable().optional(),
    rel_attributes: z.array(z.string()).nullable().optional(),
    attributes: z.array(z.string()).nullable().optional(),
  })
  .passthrough();

export const referringDomainItemSchema = z
  .object({
    domain: z.string().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    referring_pages: z.number().nullable().optional(),
    rank: z.number().nullable().optional(),
    first_seen: z.string().nullable().optional(),
    broken_backlinks: z.number().nullable().optional(),
    broken_pages: z.number().nullable().optional(),
    backlinks_spam_score: z.number().nullable().optional(),
    target_spam_score: z.number().nullable().optional(),
  })
  .passthrough();

export const domainPageSummaryItemSchema = z
  .object({
    page: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    referring_domains: z.number().nullable().optional(),
    rank: z.number().nullable().optional(),
    broken_backlinks: z.number().nullable().optional(),
  })
  .passthrough();

export const backlinksHistoryItemSchema = z
  .object({
    date: z.string().nullable().optional(),
    rank: z.number().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    referring_domains: z.number().nullable().optional(),
    new_backlinks: z.number().nullable().optional(),
    lost_backlinks: z.number().nullable().optional(),
    new_reffering_domains: z.number().nullable().optional(),
    lost_reffering_domains: z.number().nullable().optional(),
    new_referring_domains: z.number().nullable().optional(),
    lost_referring_domains: z.number().nullable().optional(),
  })
  .passthrough();

export const backlinksAnchorItemSchema = z
  .object({
    anchor: z.string().nullable().optional(),
    rank: z.number().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    referring_domains: z.number().nullable().optional(),
    referring_pages: z.number().nullable().optional(),
    first_seen: z.string().nullable().optional(),
    lost_date: z.string().nullable().optional(),
    backlinks_spam_score: z.number().nullable().optional(),
  })
  .passthrough();

export const backlinksNewLostTimeseriesItemSchema = z
  .object({
    date: z.string().nullable().optional(),
    new_backlinks: z.number().nullable().optional(),
    lost_backlinks: z.number().nullable().optional(),
    new_referring_domains: z.number().nullable().optional(),
    lost_referring_domains: z.number().nullable().optional(),
    new_referring_main_domains: z.number().nullable().optional(),
    lost_referring_main_domains: z.number().nullable().optional(),
  })
  .passthrough();

export const backlinksBulkRankItemSchema = z
  .object({
    target: z.string().nullable().optional(),
    rank: z.number().nullable().optional(),
  })
  .passthrough();

export const backlinksBulkBacklinksItemSchema = z
  .object({
    target: z.string().nullable().optional(),
    backlinks: z.number().nullable().optional(),
  })
  .passthrough();

export const backlinksBulkReferringDomainsItemSchema = z
  .object({
    target: z.string().nullable().optional(),
    referring_domains: z.number().nullable().optional(),
    referring_main_domains: z.number().nullable().optional(),
  })
  .passthrough();

function buildCommonPayload(input: BacklinksRequest) {
  return {
    target: input.target,
    include_subdomains: true,
    include_indirect_links: true,
    exclude_internal_backlinks: true,
    backlinks_status_type: "live",
    rank_scale: "one_hundred",
  };
}

const assertOptions = (path: string) =>
  ({ classify: classifyBacklinksError, classifyPath: path }) as const;

/**
 * Joins caller-provided filter expressions with the spam-score condition.
 * `userFilters` arrives already and/or-joined, so the spam condition is
 * appended with a single top-level "and".
 */
function combineFilters(
  userFilters: unknown[] | undefined,
  spamCondition: unknown[] | undefined,
): unknown[] | undefined {
  const merged: unknown[] = [];
  if (userFilters && userFilters.length > 0) merged.push(...userFilters);
  if (spamCondition) {
    if (merged.length > 0) merged.push("and");
    merged.push(spamCondition);
  }
  return merged.length > 0 ? merged : undefined;
}

export async function fetchBacklinksSummary(input: BacklinksRequest) {
  const response = await backlinksApi(classifyBacklinksError).summaryLive([
    new BacklinksSummaryLiveRequestInfo(buildCommonPayload(input)),
  ]);
  const task = assertOk(response, assertOptions("/v3/backlinks/summary/live"));

  const firstResult = task.result?.[0];
  if (firstResult) {
    const parsed = backlinksSummaryItemSchema.safeParse(firstResult);
    if (!parsed.success) {
      console.error(
        "dataforseo.backlinks-summary-live.invalid-result",
        parsed.error.issues.slice(0, 5),
      );
      throw new AppError(
        "INTERNAL_ERROR",
        "DataForSEO backlinks-summary-live returned an invalid response shape",
      );
    }
    return {
      data: parsed.data,
      billing: buildTaskBilling(task),
    } satisfies DataforseoApiResponse<typeof parsed.data>;
  }

  return {
    data: {} as z.infer<typeof backlinksSummaryItemSchema>,
    billing: buildTaskBilling(task),
  };
}

export async function fetchBacklinksRows(input: BacklinksListRequest) {
  const spamFilterOptions = normalizeBacklinksSpamFilterOptions(input);
  const filters = combineFilters(
    input.filters,
    spamFilterOptions.hideSpam
      ? ["backlink_spam_score", "<=", spamFilterOptions.spamThreshold]
      : undefined,
  );
  const response = await backlinksApi(classifyBacklinksError).backlinksLive([
    new BacklinksBacklinksLiveRequestInfo({
      ...buildCommonPayload(input),
      limit: input.limit ?? 100,
      offset: input.offset,
      order_by: input.orderBy ?? ["rank,desc"],
      mode: input.mode,
      ...(filters ? { filters } : {}),
    }),
  ]);
  const task = assertOk(
    response,
    assertOptions("/v3/backlinks/backlinks/live"),
  );
  return {
    data: {
      items: parseTaskItems("backlinks-live", task, backlinksItemSchema),
      totalCount: parseTaskTotalCount(task),
    },
    billing: buildTaskBilling(task),
  };
}

export async function fetchReferringDomains(input: BacklinksListRequest) {
  const spamFilterOptions = normalizeBacklinksSpamFilterOptions(input);
  const filters = combineFilters(
    input.filters,
    spamFilterOptions.hideSpam
      ? ["backlinks_spam_score", "<=", spamFilterOptions.spamThreshold]
      : undefined,
  );
  const response = await backlinksApi(
    classifyBacklinksError,
  ).referringDomainsLive([
    new BacklinksReferringDomainsLiveRequestInfo({
      ...buildCommonPayload(input),
      limit: input.limit ?? 100,
      offset: input.offset,
      order_by: input.orderBy ?? ["backlinks,desc"],
      ...(filters ? { filters } : {}),
    }),
  ]);
  const task = assertOk(
    response,
    assertOptions("/v3/backlinks/referring_domains/live"),
  );
  return {
    data: {
      items: parseTaskItems(
        "referring-domains-live",
        task,
        referringDomainItemSchema,
      ),
      totalCount: parseTaskTotalCount(task),
    },
    billing: buildTaskBilling(task),
  };
}

export async function fetchDomainPagesSummary(input: BacklinksListRequest) {
  const filters =
    input.filters && input.filters.length > 0 ? input.filters : undefined;
  const response = await backlinksApi(
    classifyBacklinksError,
  ).domainPagesSummaryLive([
    new BacklinksDomainPagesSummaryLiveRequestInfo({
      ...buildCommonPayload(input),
      limit: input.limit ?? 100,
      offset: input.offset,
      order_by: input.orderBy ?? ["backlinks,desc"],
      ...(filters ? { filters } : {}),
    }),
  ]);
  const task = assertOk(
    response,
    assertOptions("/v3/backlinks/domain_pages_summary/live"),
  );
  return {
    data: {
      items: parseTaskItems(
        "domain-pages-summary-live",
        task,
        domainPageSummaryItemSchema,
      ),
      totalCount: parseTaskTotalCount(task),
    },
    billing: buildTaskBilling(task),
  };
}

export async function fetchBacklinksHistory(input: BacklinksTimeseriesRequest) {
  const response = await backlinksApi(classifyBacklinksError).historyLive([
    new BacklinksHistoryLiveRequestInfo({
      target: input.target,
      date_from: input.dateFrom,
      date_to: input.dateTo,
      rank_scale: "one_hundred",
    }),
  ]);
  const task = assertOk(response, assertOptions("/v3/backlinks/history/live"));
  return {
    data: parseTaskItems(
      "backlinks-history-live",
      task,
      backlinksHistoryItemSchema,
    ),
    billing: buildTaskBilling(task),
  };
}

export async function fetchBacklinksAnchors(input: BacklinksListRequest) {
  const response = await backlinksApi(classifyBacklinksError).anchorsLive([
    new BacklinksAnchorsLiveRequestInfo({
      ...buildCommonPayload(input),
      limit: input.limit ?? 1000,
      offset: input.offset,
      order_by: input.orderBy ?? ["backlinks,desc"],
      ...(input.filters && input.filters.length > 0
        ? { filters: input.filters }
        : {}),
    }),
  ]);
  const task = assertOk(response, assertOptions("/v3/backlinks/anchors/live"));
  return {
    data: {
      items: parseTaskItems(
        "backlinks-anchors-live",
        task,
        backlinksAnchorItemSchema,
      ),
      totalCount: parseTaskTotalCount(task),
    },
    billing: buildTaskBilling(task),
  };
}

export async function fetchTimeseriesNewLostSummary(
  input: BacklinksNewLostTimeseriesRequest,
) {
  const response = await backlinksApi(
    classifyBacklinksError,
  ).timeseriesNewLostSummaryLive([
    new BacklinksTimeseriesNewLostSummaryLiveRequestInfo({
      target: input.target,
      date_from: input.dateFrom,
      date_to: input.dateTo,
      group_range: input.groupRange ?? "week",
      include_subdomains: true,
    }),
  ]);
  const task = assertOk(
    response,
    assertOptions("/v3/backlinks/timeseries_new_lost_summary/live"),
  );
  return {
    data: parseTaskItems(
      "backlinks-timeseries-new-lost-live",
      task,
      backlinksNewLostTimeseriesItemSchema,
    ),
    billing: buildTaskBilling(task),
  };
}

export async function fetchBulkRanks(input: BacklinksBulkTargetsRequest) {
  const response = await backlinksApi(classifyBacklinksError).bulkRanksLive([
    new BacklinksBulkRanksLiveRequestInfo({
      targets: input.targets,
      rank_scale: "one_hundred",
    }),
  ]);
  const task = assertOk(
    response,
    assertOptions("/v3/backlinks/bulk_ranks/live"),
  );
  return {
    data: parseTaskItems(
      "backlinks-bulk-ranks-live",
      task,
      backlinksBulkRankItemSchema,
    ),
    billing: buildTaskBilling(task),
  };
}

export async function fetchBulkBacklinks(input: BacklinksBulkTargetsRequest) {
  const response = await backlinksApi(classifyBacklinksError).bulkBacklinksLive(
    [new BacklinksBulkBacklinksLiveRequestInfo({ targets: input.targets })],
  );
  const task = assertOk(
    response,
    assertOptions("/v3/backlinks/bulk_backlinks/live"),
  );
  return {
    data: parseTaskItems(
      "backlinks-bulk-backlinks-live",
      task,
      backlinksBulkBacklinksItemSchema,
    ),
    billing: buildTaskBilling(task),
  };
}

export async function fetchBulkReferringDomains(
  input: BacklinksBulkTargetsRequest,
) {
  const response = await backlinksApi(
    classifyBacklinksError,
  ).bulkReferringDomainsLive([
    new BacklinksBulkReferringDomainsLiveRequestInfo({
      targets: input.targets,
    }),
  ]);
  const task = assertOk(
    response,
    assertOptions("/v3/backlinks/bulk_referring_domains/live"),
  );
  return {
    data: parseTaskItems(
      "backlinks-bulk-referring-domains-live",
      task,
      backlinksBulkReferringDomainsItemSchema,
    ),
    billing: buildTaskBilling(task),
  };
}

export type BacklinksSummaryItem = z.infer<typeof backlinksSummaryItemSchema>;
export type BacklinksItem = z.infer<typeof backlinksItemSchema>;
export type ReferringDomainItem = z.infer<typeof referringDomainItemSchema>;
export type DomainPageSummaryItem = z.infer<typeof domainPageSummaryItemSchema>;
export type BacklinksHistoryItem = z.infer<typeof backlinksHistoryItemSchema>;
export type BacklinksAnchorItem = z.infer<typeof backlinksAnchorItemSchema>;
export type BacklinksNewLostTimeseriesItem = z.infer<
  typeof backlinksNewLostTimeseriesItemSchema
>;
export type BacklinksBulkRankItem = z.infer<typeof backlinksBulkRankItemSchema>;
export type BacklinksBulkBacklinksItem = z.infer<
  typeof backlinksBulkBacklinksItemSchema
>;
export type BacklinksBulkReferringDomainsItem = z.infer<
  typeof backlinksBulkReferringDomainsItemSchema
>;
