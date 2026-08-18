import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import type { RankCheckResult } from "@/server/lib/dataforseo";
import { normalizeRankingUrl } from "@/shared/rank-tracking-reports";

type RankCheckResultWithDevice = RankCheckResult & {
  device: "desktop" | "mobile";
};

function mapResultsToSnapshotRows(
  runId: string,
  results: RankCheckResultWithDevice[],
) {
  return results.map((r) => ({
    runId,
    trackingKeywordId: r.keywordId,
    keyword: r.keyword,
    device: r.device,
    position: r.position,
    url: r.url,
    serpFeatures:
      r.serpFeatures.length > 0 ? JSON.stringify(r.serpFeatures) : null,
    serpCaptured: true,
  }));
}

function mapResultsToSerpEntries(
  runId: string,
  results: RankCheckResultWithDevice[],
) {
  return results.flatMap((r) => {
    const owned = r.ownedUrls.map((row) => ({
      runId,
      trackingKeywordId: r.keywordId,
      device: r.device,
      rowKind: "owned" as const,
      identity: normalizeRankingUrl(row.url),
      domain: null,
      url: row.url,
      position: row.position,
      featureOwned: null,
    }));
    const competitors = r.competitors.map((row) => ({
      runId,
      trackingKeywordId: r.keywordId,
      device: r.device,
      rowKind: "competitor" as const,
      identity: row.domain,
      domain: row.domain,
      url: null,
      position: row.position,
      featureOwned: null,
    }));
    const features = r.featureOwnership.map((row) => ({
      runId,
      trackingKeywordId: r.keywordId,
      device: r.device,
      rowKind: "feature" as const,
      identity: row.type,
      domain: null,
      url: null,
      position: null,
      featureOwned: row.owned,
    }));
    return [...owned, ...competitors, ...features].filter(
      (row) => row.identity.length > 0,
    );
  });
}

export async function persistRankCheckResults(
  runId: string,
  results: RankCheckResultWithDevice[],
) {
  if (results.length === 0) return;
  await RankTrackingRepository.insertSnapshots(
    mapResultsToSnapshotRows(runId, results),
  );
  await RankTrackingRepository.insertSerpEntries(
    mapResultsToSerpEntries(runId, results),
  );
}
