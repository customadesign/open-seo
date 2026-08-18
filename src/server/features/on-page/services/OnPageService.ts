import type { BillingCustomerContext } from "@/server/billing/subscription";
import { AppError } from "@/server/lib/errors";
import { normalizeUrl } from "@/server/lib/audit/url-utils";
import {
  MAX_ON_PAGE_PAGES_PER_RUN,
  ON_PAGE_PRIORITY_RANK,
  isOnPagePriority,
  normalizeOnPageKeyword,
  type OnPageBucket,
} from "@/shared/on-page";
import { OnPageRepository } from "../repositories/OnPageRepository";
import { fetchParsedPage } from "./onPageFetch";
import {
  detectContentIdeas,
  detectStrategyIdeas,
  mapTechnicalIdeas,
  type DetectedOnPageIdea,
  type ParsedPageSnapshot,
} from "./onPageIdeas";
import {
  estimateOnPageRunCost,
  loadOrganicTop10,
  parseEvidence,
} from "./onPageSerp";
import { collectRankings, importOnPageTargets } from "./onPageTargets";

async function loadTargets(projectId: string) {
  const pages = await OnPageRepository.listTargetPages(projectId);
  const keywords = await OnPageRepository.listTargetKeywords(
    pages.map((page) => page.id),
  );
  return pages.map((page) => ({
    ...page,
    keywords: keywords.filter((keyword) => keyword.targetPageId === page.id),
  }));
}

async function getOverview(projectId: string) {
  const [targets, counts, latestRun, latestAudit] = await Promise.all([
    loadTargets(projectId),
    OnPageRepository.countUnresolvedByPage(projectId),
    OnPageRepository.getLatestRun(projectId),
    OnPageRepository.getLatestCompletedAudit(projectId),
  ]);

  const byPage = new Map<
    string,
    { total: number; byBucket: Record<string, number> }
  >();
  const byBucket: Record<OnPageBucket, number> = {
    strategy: 0,
    content: 0,
    semantic: 0,
    backlinks: 0,
    ux: 0,
    technical: 0,
    serp_features: 0,
  };
  for (const row of counts) {
    const page = byPage.get(row.targetPageId) ?? { total: 0, byBucket: {} };
    const count = Number(row.count);
    page.total += count;
    page.byBucket[row.bucket] = (page.byBucket[row.bucket] ?? 0) + count;
    byPage.set(row.targetPageId, page);
    byBucket[row.bucket] += count;
  }

  const topPages = targets
    .map((page) => ({
      id: page.id,
      url: page.url,
      keywordCount: page.keywords.length,
      ideaCount: byPage.get(page.id)?.total ?? 0,
      byBucket: byPage.get(page.id)?.byBucket ?? {},
    }))
    .toSorted(
      (a, b) => b.ideaCount - a.ideaCount || a.url.localeCompare(b.url),
    );

  return {
    targets: topPages,
    totalIdeas: Object.values(byBucket).reduce((sum, count) => sum + count, 0),
    byBucket,
    latestRun,
    audit: latestAudit
      ? {
          id: latestAudit.id,
          status: latestAudit.status,
          completedAt: latestAudit.completedAt,
        }
      : null,
  };
}

async function getPageDetail(projectId: string, pageId: string) {
  const page = await OnPageRepository.getTargetPage(projectId, pageId);
  if (!page) throw new AppError("NOT_FOUND", "Target page not found");
  const [keywords, ideas, latestAudit] = await Promise.all([
    OnPageRepository.listTargetKeywords([page.id]),
    OnPageRepository.listIdeas(projectId, page.id),
    OnPageRepository.getLatestCompletedAudit(projectId),
  ]);
  const keywordById = new Map(keywords.map((keyword) => [keyword.id, keyword]));
  return {
    page,
    keywords,
    audit: latestAudit
      ? {
          id: latestAudit.id,
          status: latestAudit.status,
          completedAt: latestAudit.completedAt,
        }
      : null,
    ideas: ideas
      .map((idea) => ({
        ...idea,
        keyword: idea.targetKeywordId
          ? (keywordById.get(idea.targetKeywordId)?.keyword ?? null)
          : null,
        evidence: parseEvidence(idea.evidenceJson),
      }))
      .toSorted((a, b) => {
        const aRank = isOnPagePriority(a.priority)
          ? ON_PAGE_PRIORITY_RANK[a.priority]
          : 9;
        const bRank = isOnPagePriority(b.priority)
          ? ON_PAGE_PRIORITY_RANK[b.priority]
          : 9;
        if (aRank !== bRank) return aRank - bRank;
        if (a.resolvedAt && !b.resolvedAt) return 1;
        if (!a.resolvedAt && b.resolvedAt) return -1;
        return a.title.localeCompare(b.title);
      }),
  };
}

async function addTarget(input: {
  projectId: string;
  url: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
}) {
  const url = normalizeUrl(input.url);
  if (!url) {
    throw new AppError("VALIDATION_ERROR", "Enter a valid http(s) URL");
  }
  const page = await OnPageRepository.upsertTargetPage({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    url,
  });
  const keyword = await OnPageRepository.upsertTargetKeyword({
    id: crypto.randomUUID(),
    targetPageId: page.id,
    keyword: normalizeOnPageKeyword(input.keyword),
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    source: "manual",
  });
  return { pageId: page.id, keywordId: keyword.id, url };
}

async function removeTarget(projectId: string, pageId: string) {
  const page = await OnPageRepository.getTargetPage(projectId, pageId);
  if (!page) throw new AppError("NOT_FOUND", "Target page not found");
  await OnPageRepository.deleteTargetPage(projectId, pageId);
}

async function removeKeyword(projectId: string, keywordId: string) {
  const pages = await OnPageRepository.listTargetPages(projectId);
  const keywords = await OnPageRepository.listTargetKeywords(
    pages.map((page) => page.id),
  );
  const keyword = keywords.find((row) => row.id === keywordId);
  if (!keyword) throw new AppError("NOT_FOUND", "Target keyword not found");
  await OnPageRepository.deleteTargetKeyword(keywordId);
}

async function importTargets(projectId: string) {
  return importOnPageTargets(projectId);
}

async function estimateRun(projectId: string) {
  return estimateOnPageRunCost(await loadTargets(projectId));
}

async function runChecker(
  projectId: string,
  billingCustomer: BillingCustomerContext,
) {
  const startedAt = new Date().toISOString();
  const targets = await loadTargets(projectId);
  const contentPages = targets.slice(0, MAX_ON_PAGE_PAGES_PER_RUN);
  const detected: DetectedOnPageIdea[] = [];
  let serpFetches = 0;
  const parsedCache = new Map<string, ParsedPageSnapshot | null>();

  async function parsed(url: string) {
    const cached = parsedCache.get(url);
    if (cached !== undefined) return cached;
    const snapshot = await fetchParsedPage(url);
    parsedCache.set(url, snapshot);
    return snapshot;
  }

  const latestAudit = await OnPageRepository.getLatestCompletedAudit(projectId);
  const auditIssues = latestAudit
    ? await OnPageRepository.getAuditIssues(latestAudit.id)
    : [];
  for (const page of targets) {
    detected.push(
      ...mapTechnicalIdeas({
        targetPageId: page.id,
        pageUrl: page.url,
        issues: auditIssues,
      }),
    );
  }

  const { rankings } = await collectRankings(projectId);
  detected.push(
    ...detectStrategyIdeas({
      targets: targets.flatMap((page) =>
        page.keywords.map((keyword) => ({
          pageId: page.id,
          pageUrl: page.url,
          keywordId: keyword.id,
          keyword: keyword.keyword,
          locationCode: keyword.locationCode,
          languageCode: keyword.languageCode,
        })),
      ),
      rankings,
    }),
  );

  for (const page of contentPages) {
    const targetSnapshot = await parsed(page.url);
    if (!targetSnapshot) continue;
    for (const keyword of page.keywords) {
      const serp = await loadOrganicTop10(keyword, billingCustomer);
      if (serp.fetched) serpFetches += 1;
      const competitors: ParsedPageSnapshot[] = [];
      for (const item of serp.items) {
        if (!item.url) continue;
        const snapshot = await parsed(item.url);
        if (snapshot) competitors.push(snapshot);
      }
      detected.push(
        ...detectContentIdeas({
          targetPageId: page.id,
          targetKeywordId: keyword.id,
          keyword: keyword.keyword,
          target: targetSnapshot,
          competitors,
        }),
      );
    }
  }

  const seenAt = new Date().toISOString();
  const keepDedupeKeys = detected.map((idea) => idea.dedupeKey);
  await OnPageRepository.upsertDetectedIdeas(projectId, detected, seenAt);
  // Technical and strategy run over every target. Content only runs for the
  // capped page set, so unresolved content ideas on skipped pages must stay.
  await OnPageRepository.resolveMissingIdeas({
    projectId,
    pageIds: targets.map((page) => page.id),
    buckets: ["technical", "strategy"],
    keepDedupeKeys,
    resolvedAt: seenAt,
  });
  await OnPageRepository.resolveMissingIdeas({
    projectId,
    pageIds: contentPages.map((page) => page.id),
    buckets: ["content"],
    keepDedupeKeys,
    resolvedAt: seenAt,
  });
  await OnPageRepository.insertRun({
    id: crypto.randomUUID(),
    projectId,
    status: "completed",
    pagesTotal: targets.length,
    pagesProcessed: contentPages.length,
    serpFetches,
    ideasDetected: detected.length,
    errorMessage: null,
    startedAt,
    completedAt: seenAt,
  });

  return {
    pagesTotal: targets.length,
    pagesProcessed: contentPages.length,
    serpFetches,
    ideasDetected: detected.length,
    auditPresent: latestAudit != null,
  };
}

export const OnPageService = {
  getOverview,
  getPageDetail,
  addTarget,
  removeTarget,
  removeKeyword,
  importTargets,
  estimateRun,
  runChecker,
};

export type OnPageOverview = Awaited<ReturnType<typeof getOverview>>;
export type OnPagePageDetail = Awaited<ReturnType<typeof getPageDetail>>;
