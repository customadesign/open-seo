import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { KeywordResearchService } from "@/server/features/keywords/services/KeywordResearchService";
import {
  estimatedTraffic,
  visibilityPercent,
} from "@/shared/rank-tracking-visibility";
import {
  loadReportContext,
  requireConfig,
  snapshotsForDevice,
  volumeByKeywordId,
  type Device,
} from "./rankTrackingReportContext";
export type { CompetitorsReport } from "./rankTrackingSerpReports";

export type TagReportRow = {
  tagId: string;
  name: string;
  color: string | null;
  keywordCount: number;
  visibility: number | null;
  previousVisibility: number | null;
  visibilityDelta: number | null;
  averagePosition: number | null;
  estimatedTraffic: number | null;
  trend: Array<{
    runId: string;
    checkedAt: string;
    visibility: number | null;
    averagePosition: number | null;
    estimatedTraffic: number | null;
  }>;
};

export type TagsReport = {
  tags: TagReportRow[];
  untaggedKeywordCount: number;
};

export async function getTags(
  configId: string,
  projectId: string,
  device: Device,
): Promise<TagsReport> {
  const { config, snapshots, runs, keywords } = await loadReportContext(
    configId,
    projectId,
  );
  const assignments = await RankTrackingRepository.getTagAssignmentsForConfig({
    projectId,
    configId,
    locationCode: config.locationCode,
    languageCode: config.languageCode,
  });
  const volumes = volumeByKeywordId(keywords);
  const deviceRows = snapshotsForDevice(snapshots, device);
  const taggedIds = new Set(assignments.map((row) => row.trackingKeywordId));

  const keywordsByTag = new Map<string, Set<string>>();
  const tagMeta = new Map<string, { name: string; color: string | null }>();
  for (const assignment of assignments) {
    tagMeta.set(assignment.tagId, {
      name: assignment.tagName,
      color: assignment.tagColor,
    });
    const ids = keywordsByTag.get(assignment.tagId) ?? new Set();
    ids.add(assignment.trackingKeywordId);
    keywordsByTag.set(assignment.tagId, ids);
  }

  const chronological = runs.toReversed();
  const tags: TagReportRow[] = [];

  for (const [tagId, keywordIds] of keywordsByTag) {
    const meta = tagMeta.get(tagId);
    if (!meta) continue;
    const trend = chronological.map((run) => {
      const rows = deviceRows
        .filter(
          (row) =>
            row.runId === run.id && keywordIds.has(row.trackingKeywordId),
        )
        .map((row) => ({
          searchVolume: volumes.get(row.trackingKeywordId) ?? null,
          position: row.position,
        }));
      const ranking = rows
        .map((row) => row.position)
        .filter((position): position is number => position != null);
      const trafficValues = rows
        .map((row) => estimatedTraffic(row.searchVolume, row.position))
        .filter((value): value is number => value != null);
      return {
        runId: run.id,
        checkedAt: run.startedAt,
        visibility: visibilityPercent(rows),
        averagePosition:
          ranking.length > 0
            ? ranking.reduce((sum, value) => sum + value, 0) / ranking.length
            : null,
        estimatedTraffic:
          trafficValues.length > 0
            ? trafficValues.reduce((sum, value) => sum + value, 0)
            : null,
      };
    });
    const current = trend[trend.length - 1];
    const previous = trend.length > 1 ? trend[trend.length - 2] : null;
    tags.push({
      tagId,
      name: meta.name,
      color: meta.color,
      keywordCount: keywordIds.size,
      visibility: current?.visibility ?? null,
      previousVisibility: previous?.visibility ?? null,
      visibilityDelta:
        current?.visibility != null && previous?.visibility != null
          ? current.visibility - previous.visibility
          : null,
      averagePosition: current?.averagePosition ?? null,
      estimatedTraffic: current?.estimatedTraffic ?? null,
      trend,
    });
  }

  return {
    tags: tags.toSorted((a, b) => a.name.localeCompare(b.name)),
    untaggedKeywordCount: keywords.filter(
      (keyword) => !taggedIds.has(keyword.id),
    ).length,
  };
}

export async function tagTrackingKeywords(input: {
  configId: string;
  projectId: string;
  keywordIds: string[];
  tags: string[];
}) {
  const config = await requireConfig(input.configId, input.projectId);
  const keywords = await RankTrackingRepository.getKeywordsForConfig(
    input.configId,
  );
  const allowed = new Set(input.keywordIds);
  const texts = keywords
    .filter((keyword) => allowed.has(keyword.id))
    .map((keyword) => keyword.keyword);
  if (texts.length === 0) {
    return { savedKeywordIds: [] as string[] };
  }
  return KeywordResearchService.saveKeywords({
    projectId: input.projectId,
    keywords: texts,
    locationCode: config.locationCode,
    languageCode: config.languageCode,
    tags: input.tags,
  });
}
