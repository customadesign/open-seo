import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import {
  keywordGapKeywords,
  keywordGapPositions,
  keywordGapRunDomains,
  keywordGapRuns,
} from "@/db/schema";
import type { KeywordGapClassification } from "@/shared/gap";

export type KeywordGapRunRecord = typeof keywordGapRuns.$inferSelect;
export type KeywordGapDomainRecord = typeof keywordGapRunDomains.$inferSelect;
export type KeywordGapKeywordRecord = typeof keywordGapKeywords.$inferSelect;
export type KeywordGapPositionRecord = typeof keywordGapPositions.$inferSelect;

export type KeywordGapRunWrite = {
  id: string;
  projectId: string;
  fingerprint: string;
  locationCode: number;
  languageCode: string;
  includeSubdomains: boolean;
  fetchedAt: string;
  domains: Array<{
    id: string;
    domain: string;
    role: "base" | "competitor";
    sortOrder: number;
  }>;
  keywords: Array<{
    id: string;
    keyword: string;
    searchVolume: number | null;
    keywordDifficulty: number | null;
    intent: string | null;
    cpc: number | null;
    classification: KeywordGapClassification;
    positions: Array<{
      id: string;
      domain: string;
      position: number | null;
    }>;
  }>;
};

async function findFreshRun(input: {
  projectId: string;
  fingerprint: string;
  fetchedAfter: string;
}) {
  const [run] = await db
    .select()
    .from(keywordGapRuns)
    .where(
      and(
        eq(keywordGapRuns.projectId, input.projectId),
        eq(keywordGapRuns.fingerprint, input.fingerprint),
        gt(keywordGapRuns.fetchedAt, input.fetchedAfter),
      ),
    )
    .limit(1);
  return run ?? null;
}

async function getRun(input: { projectId: string; runId: string }) {
  const [run] = await db
    .select()
    .from(keywordGapRuns)
    .where(
      and(
        eq(keywordGapRuns.id, input.runId),
        eq(keywordGapRuns.projectId, input.projectId),
      ),
    )
    .limit(1);
  return run ?? null;
}

async function listDomains(runId: string) {
  return db
    .select()
    .from(keywordGapRunDomains)
    .where(eq(keywordGapRunDomains.runId, runId));
}

async function listKeywords(runId: string) {
  return db
    .select()
    .from(keywordGapKeywords)
    .where(eq(keywordGapKeywords.runId, runId));
}

async function listPositions(keywordIds: string[]) {
  if (keywordIds.length === 0) return [];
  const rows: KeywordGapPositionRecord[] = [];
  for (let index = 0; index < keywordIds.length; index += 100) {
    const chunk = keywordIds.slice(index, index + 100);
    const matches = await db
      .select()
      .from(keywordGapPositions)
      .where(inArray(keywordGapPositions.keywordId, chunk));
    rows.push(...matches);
  }
  return rows;
}

async function replaceRun(input: KeywordGapRunWrite) {
  const existing = await db
    .select({ id: keywordGapRuns.id })
    .from(keywordGapRuns)
    .where(
      and(
        eq(keywordGapRuns.projectId, input.projectId),
        eq(keywordGapRuns.fingerprint, input.fingerprint),
      ),
    );
  for (const run of existing) {
    await db.delete(keywordGapRuns).where(eq(keywordGapRuns.id, run.id));
  }

  await db.insert(keywordGapRuns).values({
    id: input.id,
    projectId: input.projectId,
    fingerprint: input.fingerprint,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    includeSubdomains: input.includeSubdomains,
    fetchedAt: input.fetchedAt,
  });

  await executeInBatches(input.domains, (tx, domain) =>
    tx.insert(keywordGapRunDomains).values({
      id: domain.id,
      runId: input.id,
      domain: domain.domain,
      role: domain.role,
      sortOrder: domain.sortOrder,
    }),
  );

  await executeInBatches(input.keywords, (tx, keyword) =>
    tx.insert(keywordGapKeywords).values({
      id: keyword.id,
      runId: input.id,
      keyword: keyword.keyword,
      searchVolume: keyword.searchVolume,
      keywordDifficulty: keyword.keywordDifficulty,
      intent: keyword.intent,
      cpc: keyword.cpc,
      classification: keyword.classification,
    }),
  );

  const positions = input.keywords.flatMap((keyword) =>
    keyword.positions.map((position) => ({
      ...position,
      keywordId: keyword.id,
    })),
  );
  await executeInBatches(positions, (tx, position) =>
    tx.insert(keywordGapPositions).values({
      id: position.id,
      keywordId: position.keywordId,
      domain: position.domain,
      position: position.position,
    }),
  );
}

export const KeywordGapRepository = {
  findFreshRun,
  getRun,
  listDomains,
  listKeywords,
  listPositions,
  replaceRun,
};
