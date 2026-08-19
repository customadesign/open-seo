import {
  DataforseoLabsGoogleBulkTrafficEstimationLiveRequestInfo,
  DataforseoLabsGoogleCompetitorsDomainLiveRequestInfo,
  DataforseoLabsGoogleHistoricalRankOverviewLiveRequestInfo,
  DataforseoLabsGoogleSubdomainsLiveRequestInfo,
  type DataforseoLabsCompetitorsDomainLiveItem,
  type DataforseoLabsGoogleBulkTrafficEstimationLiveItem,
  type DataforseoLabsGoogleHistoricalRankOverviewLiveItem,
  type DataforseoLabsSubdomainsLiveItem,
} from "dataforseo-client";
import { labsApi } from "@/server/lib/dataforseo/core";
import {
  assertOk,
  buildTaskBilling,
  type DataforseoApiResponse,
} from "@/server/lib/dataforseo/envelope";

export type CompetitorsDomainItem = DataforseoLabsCompetitorsDomainLiveItem;
export type SubdomainsItem = DataforseoLabsSubdomainsLiveItem;
export type HistoricalRankOverviewItem =
  DataforseoLabsGoogleHistoricalRankOverviewLiveItem;
export type BulkTrafficEstimationItem =
  DataforseoLabsGoogleBulkTrafficEstimationLiveItem;

type DataforseoLabsItemType =
  | "organic"
  | "paid"
  | "featured_snippet"
  | "local_pack"
  | "ai_overview_reference";

type CompetitorsDomainPage = {
  items: CompetitorsDomainItem[];
  totalCount: number | null;
};

export async function fetchCompetitorsDomain(input: {
  target: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  offset?: number;
  excludeTopDomains?: boolean;
  itemTypes?: DataforseoLabsItemType[];
}): Promise<DataforseoApiResponse<CompetitorsDomainPage>> {
  const response = await labsApi().googleCompetitorsDomainLive([
    new DataforseoLabsGoogleCompetitorsDomainLiveRequestInfo({
      target: input.target,
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      offset: input.offset,
      exclude_top_domains: input.excludeTopDomains ?? true,
      item_types: input.itemTypes ?? ["organic"],
    }),
  ]);
  const task = assertOk(response);
  return {
    data: {
      items: task.result?.[0]?.items ?? [],
      totalCount: task.result?.[0]?.total_count ?? null,
    },
    billing: buildTaskBilling(task),
  };
}

type SubdomainsPage = {
  items: SubdomainsItem[];
  totalCount: number | null;
};

export async function fetchSubdomains(input: {
  target: string;
  locationCode: number;
  languageCode: string;
  limit: number;
  offset?: number;
  orderBy?: string[];
}): Promise<DataforseoApiResponse<SubdomainsPage>> {
  const response = await labsApi().googleSubdomainsLive([
    new DataforseoLabsGoogleSubdomainsLiveRequestInfo({
      target: input.target,
      location_code: input.locationCode,
      language_code: input.languageCode,
      limit: input.limit,
      offset: input.offset,
      order_by: input.orderBy,
      item_types: ["organic"],
    }),
  ]);
  const task = assertOk(response);
  return {
    data: {
      items: task.result?.[0]?.items ?? [],
      totalCount: task.result?.[0]?.total_count ?? null,
    },
    billing: buildTaskBilling(task),
  };
}

export async function fetchHistoricalRankOverview(input: {
  target: string;
  locationCode: number;
  languageCode: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<DataforseoApiResponse<HistoricalRankOverviewItem[]>> {
  const response = await labsApi().googleHistoricalRankOverviewLive([
    new DataforseoLabsGoogleHistoricalRankOverviewLiveRequestInfo({
      target: input.target,
      location_code: input.locationCode,
      language_code: input.languageCode,
      date_from: input.dateFrom,
      date_to: input.dateTo,
      correlate: true,
    }),
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}

export async function fetchBulkTrafficEstimation(input: {
  targets: string[];
  locationCode: number;
  languageCode: string;
}): Promise<DataforseoApiResponse<BulkTrafficEstimationItem[]>> {
  const response = await labsApi().googleBulkTrafficEstimationLive([
    new DataforseoLabsGoogleBulkTrafficEstimationLiveRequestInfo({
      targets: input.targets,
      location_code: input.locationCode,
      language_code: input.languageCode,
      item_types: ["organic"],
    }),
  ]);
  const task = assertOk(response);
  return {
    data: task.result?.[0]?.items ?? [],
    billing: buildTaskBilling(task),
  };
}
