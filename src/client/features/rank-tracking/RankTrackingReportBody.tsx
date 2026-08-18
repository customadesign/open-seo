import type { RankPositionMatrixCell } from "@/serverFunctions/rank-tracking";
import type { RankTrackingConfig } from "@/types/schemas/rank-tracking";
import type { RankTrackingRow } from "@/types/schemas/rank-tracking";
import { RankTrackingHistoryMatrix } from "./RankTrackingHistoryMatrix";
import { RankTrackingTable } from "./RankTrackingTable";
import type { RankReportTab } from "./RankTrackingReportTabs";
import {
  CannibalizationReportPanel,
  DistributionReportPanel,
  PagesReportPanel,
  SnippetsReportPanel,
  TagsReportPanel,
} from "./RankTrackingReportPanels";
import {
  CompetitorsReportPanel,
  VisibilityReportPanel,
} from "./RankTrackingReportExtraPanels";

export function RankTrackingReportBody({
  tab,
  projectId,
  config,
  device,
  readOnly,
  rows,
  filtered,
  resultsLoading,
  showDesktop,
  showMobile,
  defaultSortId,
  matrixCells,
  matrixLoading,
}: {
  tab: RankReportTab;
  projectId: string;
  config: RankTrackingConfig;
  device: "desktop" | "mobile";
  readOnly: boolean;
  rows: RankTrackingRow[];
  filtered: RankTrackingRow[];
  resultsLoading: boolean;
  showDesktop: boolean;
  showMobile: boolean;
  defaultSortId: string;
  matrixCells: RankPositionMatrixCell[] | undefined;
  matrixLoading: boolean;
}) {
  if (tab === "history") {
    return (
      <RankTrackingHistoryMatrix
        cells={matrixCells ?? []}
        isLoading={matrixLoading}
        keywords={filtered.map((row) => ({
          trackingKeywordId: row.trackingKeywordId,
          keyword: row.keyword,
        }))}
      />
    );
  }
  if (tab === "distribution") {
    return (
      <DistributionReportPanel
        projectId={projectId}
        configId={config.id}
        device={device}
      />
    );
  }
  if (tab === "cannibalization") {
    return (
      <CannibalizationReportPanel
        projectId={projectId}
        configId={config.id}
        device={device}
      />
    );
  }
  if (tab === "tags") {
    return (
      <TagsReportPanel
        projectId={projectId}
        configId={config.id}
        device={device}
        readOnly={readOnly}
        keywordIds={rows.map((row) => row.trackingKeywordId)}
      />
    );
  }
  if (tab === "pages") {
    return (
      <PagesReportPanel
        projectId={projectId}
        configId={config.id}
        device={device}
      />
    );
  }
  if (tab === "snippets") {
    return (
      <SnippetsReportPanel
        projectId={projectId}
        configId={config.id}
        device={device}
      />
    );
  }
  if (tab === "competitors") {
    return (
      <CompetitorsReportPanel
        projectId={projectId}
        configId={config.id}
        device={device}
      />
    );
  }
  if (tab === "visibility") {
    return (
      <VisibilityReportPanel
        projectId={projectId}
        configId={config.id}
        device={device}
      />
    );
  }
  return (
    <RankTrackingTable
      key={defaultSortId}
      totalCount={rows.length}
      rows={filtered}
      resultsLoading={resultsLoading}
      showDesktop={showDesktop}
      showMobile={showMobile}
      defaultSortId={defaultSortId}
      domain={config.domain}
      configId={config.id}
      projectId={projectId}
      locationCode={config.locationCode}
      locationName={config.locationName}
      serpDepth={config.serpDepth}
      readOnly={readOnly}
    />
  );
}
