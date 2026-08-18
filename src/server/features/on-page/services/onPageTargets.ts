import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { normalizeUrl } from "@/server/lib/audit/url-utils";
import {
  normalizeOnPageKeyword,
  type OnPageTargetSource,
} from "@/shared/on-page";
import { OnPageRepository } from "../repositories/OnPageRepository";

export async function collectRankings(projectId: string) {
  const configs = await RankTrackingRepository.getConfigsForProject(projectId);
  const rankings: Array<{
    url: string | null;
    keyword: string;
    position: number | null;
  }> = [];
  const keywordUrls: Array<{
    keyword: string;
    locationCode: number;
    languageCode: string;
    url: string;
    source: OnPageTargetSource;
  }> = [];

  for (const config of configs) {
    const [keywords, snapshots] = await Promise.all([
      RankTrackingRepository.getKeywordsForConfig(config.id),
      RankTrackingRepository.getLatestSnapshotsForKeywords(config.id),
    ]);
    for (const snapshot of snapshots) {
      rankings.push({
        url: snapshot.url,
        keyword: snapshot.keyword,
        position: snapshot.position,
      });
    }
    for (const keyword of keywords) {
      const desktop = snapshots.find(
        (row) =>
          row.trackingKeywordId === keyword.id &&
          row.device === "desktop" &&
          row.url,
      );
      const mobile = snapshots.find(
        (row) =>
          row.trackingKeywordId === keyword.id &&
          row.device === "mobile" &&
          row.url,
      );
      const url = desktop?.url ?? mobile?.url;
      if (!url) continue;
      keywordUrls.push({
        keyword: normalizeOnPageKeyword(keyword.keyword),
        locationCode: config.locationCode,
        languageCode: config.languageCode,
        url,
        source: "rank_tracking",
      });
    }
  }

  return { rankings, keywordUrls };
}

export async function importOnPageTargets(projectId: string) {
  const { keywordUrls } = await collectRankings(projectId);
  const saved = await OnPageRepository.listSavedKeywords(projectId);
  const byKey = new Map<string, (typeof keywordUrls)[number]>();
  for (const row of keywordUrls) {
    byKey.set(`${row.keyword}|${row.locationCode}|${row.languageCode}`, row);
  }
  for (const row of saved) {
    const keyword = normalizeOnPageKeyword(row.keyword);
    const key = `${keyword}|${row.locationCode}|${row.languageCode}`;
    const mapped = byKey.get(key);
    if (!mapped || mapped.source === "rank_tracking") continue;
    byKey.set(key, { ...mapped, source: "saved_keyword" });
  }

  let importedPages = 0;
  let importedKeywords = 0;
  const seenPages = new Set<string>();
  for (const row of byKey.values()) {
    const url = normalizeUrl(row.url);
    if (!url) continue;
    const page = await OnPageRepository.upsertTargetPage({
      id: crypto.randomUUID(),
      projectId,
      url,
    });
    if (!seenPages.has(page.id)) {
      seenPages.add(page.id);
      importedPages += 1;
    }
    await OnPageRepository.upsertTargetKeyword({
      id: crypto.randomUUID(),
      targetPageId: page.id,
      keyword: row.keyword,
      locationCode: row.locationCode,
      languageCode: row.languageCode,
      source: row.source,
    });
    importedKeywords += 1;
  }
  return { importedPages, importedKeywords };
}
