import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import {
  auditIssues,
  audits,
  onPageIdeas,
  onPageRuns,
  onPageSerpCache,
  onPageTargetKeywords,
  onPageTargetPages,
  savedKeywords,
} from "@/db/schema";
import type {
  OnPageImplementedBucket,
  OnPageTargetSource,
} from "@/shared/on-page";
import type { DetectedOnPageIdea } from "../services/onPageIdeas";

async function upsertTargetPage(input: {
  id: string;
  projectId: string;
  url: string;
}) {
  const rows = await db
    .insert(onPageTargetPages)
    .values({
      id: input.id,
      projectId: input.projectId,
      url: input.url,
    })
    .onConflictDoUpdate({
      target: [onPageTargetPages.projectId, onPageTargetPages.url],
      set: { updatedAt: new Date().toISOString() },
    })
    .returning({ id: onPageTargetPages.id });
  const row = rows[0];
  if (!row) throw new Error("upsert target page returned no row");
  return row;
}

async function upsertTargetKeyword(input: {
  id: string;
  targetPageId: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  source: OnPageTargetSource;
}) {
  const rows = await db
    .insert(onPageTargetKeywords)
    .values(input)
    .onConflictDoUpdate({
      target: [
        onPageTargetKeywords.targetPageId,
        onPageTargetKeywords.keyword,
        onPageTargetKeywords.locationCode,
        onPageTargetKeywords.languageCode,
      ],
      set: { source: input.source },
    })
    .returning({ id: onPageTargetKeywords.id });
  const row = rows[0];
  if (!row) throw new Error("upsert target keyword returned no row");
  return row;
}

async function listTargetPages(projectId: string) {
  return db
    .select()
    .from(onPageTargetPages)
    .where(eq(onPageTargetPages.projectId, projectId))
    .orderBy(onPageTargetPages.createdAt);
}

async function listTargetKeywords(pageIds: string[]) {
  if (pageIds.length === 0) return [];
  return db
    .select()
    .from(onPageTargetKeywords)
    .where(inArray(onPageTargetKeywords.targetPageId, pageIds));
}

async function getTargetPage(projectId: string, pageId: string) {
  const rows = await db
    .select()
    .from(onPageTargetPages)
    .where(
      and(
        eq(onPageTargetPages.id, pageId),
        eq(onPageTargetPages.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function deleteTargetPage(projectId: string, pageId: string) {
  await db
    .delete(onPageTargetPages)
    .where(
      and(
        eq(onPageTargetPages.id, pageId),
        eq(onPageTargetPages.projectId, projectId),
      ),
    );
}

async function deleteTargetKeyword(keywordId: string) {
  await db
    .delete(onPageTargetKeywords)
    .where(eq(onPageTargetKeywords.id, keywordId));
}

async function listIdeas(projectId: string, pageId?: string) {
  return db
    .select()
    .from(onPageIdeas)
    .where(
      and(
        eq(onPageIdeas.projectId, projectId),
        pageId ? eq(onPageIdeas.targetPageId, pageId) : undefined,
      ),
    );
}

async function upsertDetectedIdeas(
  projectId: string,
  ideas: DetectedOnPageIdea[],
  seenAt: string,
) {
  if (ideas.length === 0) return;
  await executeInBatches(ideas, async (tx, idea) =>
    tx
      .insert(onPageIdeas)
      .values({
        id: crypto.randomUUID(),
        projectId,
        targetPageId: idea.targetPageId,
        targetKeywordId: idea.targetKeywordId,
        bucket: idea.bucket,
        ideaType: idea.ideaType,
        priority: idea.priority,
        title: idea.title,
        summary: idea.summary,
        evidenceJson: JSON.stringify(idea.evidence),
        dedupeKey: idea.dedupeKey,
        detectedAt: seenAt,
        lastSeenAt: seenAt,
        resolvedAt: null,
      })
      .onConflictDoUpdate({
        target: [onPageIdeas.projectId, onPageIdeas.dedupeKey],
        set: {
          targetPageId: idea.targetPageId,
          targetKeywordId: idea.targetKeywordId,
          bucket: idea.bucket,
          ideaType: idea.ideaType,
          priority: idea.priority,
          title: idea.title,
          summary: idea.summary,
          evidenceJson: JSON.stringify(idea.evidence),
          lastSeenAt: seenAt,
          resolvedAt: null,
        },
      }),
  );
}

async function resolveMissingIdeas(input: {
  projectId: string;
  pageIds: string[];
  buckets: OnPageImplementedBucket[];
  keepDedupeKeys: string[];
  resolvedAt: string;
}) {
  if (input.pageIds.length === 0 || input.buckets.length === 0) return;
  const keep = new Set(input.keepDedupeKeys);
  const existing = await db
    .select({
      id: onPageIdeas.id,
      dedupeKey: onPageIdeas.dedupeKey,
    })
    .from(onPageIdeas)
    .where(
      and(
        eq(onPageIdeas.projectId, input.projectId),
        inArray(onPageIdeas.targetPageId, input.pageIds),
        inArray(onPageIdeas.bucket, input.buckets),
        isNull(onPageIdeas.resolvedAt),
      ),
    );
  const staleIds = existing
    .filter((row) => !keep.has(row.dedupeKey))
    .map((row) => row.id);
  if (staleIds.length === 0) return;
  await db
    .update(onPageIdeas)
    .set({ resolvedAt: input.resolvedAt })
    .where(inArray(onPageIdeas.id, staleIds));
}

async function getSerpCache(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  fetchedDate: string;
}) {
  const rows = await db
    .select()
    .from(onPageSerpCache)
    .where(
      and(
        eq(onPageSerpCache.keyword, input.keyword),
        eq(onPageSerpCache.locationCode, input.locationCode),
        eq(onPageSerpCache.languageCode, input.languageCode),
        eq(onPageSerpCache.fetchedDate, input.fetchedDate),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function saveSerpCache(input: {
  id: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  fetchedDate: string;
  resultsJson: string;
}) {
  await db
    .insert(onPageSerpCache)
    .values({
      ...input,
      fetchedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [
        onPageSerpCache.keyword,
        onPageSerpCache.locationCode,
        onPageSerpCache.languageCode,
        onPageSerpCache.fetchedDate,
      ],
      set: {
        resultsJson: input.resultsJson,
        fetchedAt: new Date().toISOString(),
      },
    });
}

async function insertRun(input: {
  id: string;
  projectId: string;
  status: "completed" | "failed";
  pagesTotal: number;
  pagesProcessed: number;
  serpFetches: number;
  ideasDetected: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string;
}) {
  await db.insert(onPageRuns).values(input);
}

async function getLatestRun(projectId: string) {
  const rows = await db
    .select()
    .from(onPageRuns)
    .where(eq(onPageRuns.projectId, projectId))
    .orderBy(desc(onPageRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function getLatestCompletedAudit(projectId: string) {
  const rows = await db
    .select()
    .from(audits)
    .where(and(eq(audits.projectId, projectId), eq(audits.status, "completed")))
    .orderBy(desc(audits.completedAt), desc(audits.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

async function getAuditIssues(auditId: string) {
  return db
    .select({
      issueType: auditIssues.issueType,
      severity: auditIssues.severity,
      pageUrl: auditIssues.pageUrl,
      detailsJson: auditIssues.detailsJson,
    })
    .from(auditIssues)
    .where(eq(auditIssues.auditId, auditId));
}

async function listSavedKeywords(projectId: string) {
  return db
    .select({
      keyword: savedKeywords.keyword,
      locationCode: savedKeywords.locationCode,
      languageCode: savedKeywords.languageCode,
    })
    .from(savedKeywords)
    .where(eq(savedKeywords.projectId, projectId));
}

async function countUnresolvedByPage(projectId: string) {
  return db
    .select({
      targetPageId: onPageIdeas.targetPageId,
      bucket: onPageIdeas.bucket,
      count: sql<number>`count(*)`,
    })
    .from(onPageIdeas)
    .where(
      and(eq(onPageIdeas.projectId, projectId), isNull(onPageIdeas.resolvedAt)),
    )
    .groupBy(onPageIdeas.targetPageId, onPageIdeas.bucket);
}

export const OnPageRepository = {
  upsertTargetPage,
  upsertTargetKeyword,
  listTargetPages,
  listTargetKeywords,
  getTargetPage,
  deleteTargetPage,
  deleteTargetKeyword,
  listIdeas,
  upsertDetectedIdeas,
  resolveMissingIdeas,
  getSerpCache,
  saveSerpCache,
  insertRun,
  getLatestRun,
  getLatestCompletedAudit,
  getAuditIssues,
  listSavedKeywords,
  countUnresolvedByPage,
};
