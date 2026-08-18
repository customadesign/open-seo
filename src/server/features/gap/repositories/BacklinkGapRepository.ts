import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import {
  backlinkGapLinks,
  backlinkGapReferringDomains,
  backlinkGapRunDomains,
  backlinkGapRuns,
} from "@/db/schema";

export type BacklinkGapRunRecord = typeof backlinkGapRuns.$inferSelect;
export type BacklinkGapDomainRecord = typeof backlinkGapRunDomains.$inferSelect;
export type BacklinkGapReferringDomainRecord =
  typeof backlinkGapReferringDomains.$inferSelect;
export type BacklinkGapLinkRecord = typeof backlinkGapLinks.$inferSelect;

export type BacklinkGapRunWrite = {
  id: string;
  projectId: string;
  fingerprint: string;
  fetchedAt: string;
  domains: Array<{
    id: string;
    domain: string;
    role: "base" | "competitor";
    sortOrder: number;
  }>;
  referringDomains: Array<{
    id: string;
    referringDomain: string;
    rank: number | null;
    firstSeen: string | null;
    competitorCount: number;
    competitorDomains: Array<{ id: string; domain: string }>;
  }>;
};

async function findFreshRun(input: {
  projectId: string;
  fingerprint: string;
  fetchedAfter: string;
}) {
  const [run] = await db
    .select()
    .from(backlinkGapRuns)
    .where(
      and(
        eq(backlinkGapRuns.projectId, input.projectId),
        eq(backlinkGapRuns.fingerprint, input.fingerprint),
        gt(backlinkGapRuns.fetchedAt, input.fetchedAfter),
      ),
    )
    .limit(1);
  return run ?? null;
}

async function getRun(input: { projectId: string; runId: string }) {
  const [run] = await db
    .select()
    .from(backlinkGapRuns)
    .where(
      and(
        eq(backlinkGapRuns.id, input.runId),
        eq(backlinkGapRuns.projectId, input.projectId),
      ),
    )
    .limit(1);
  return run ?? null;
}

async function listDomains(runId: string) {
  return db
    .select()
    .from(backlinkGapRunDomains)
    .where(eq(backlinkGapRunDomains.runId, runId));
}

async function listReferringDomains(runId: string) {
  return db
    .select()
    .from(backlinkGapReferringDomains)
    .where(eq(backlinkGapReferringDomains.runId, runId));
}

async function listLinks(referringDomainIds: string[]) {
  if (referringDomainIds.length === 0) return [];
  const rows: BacklinkGapLinkRecord[] = [];
  for (let index = 0; index < referringDomainIds.length; index += 100) {
    const chunk = referringDomainIds.slice(index, index + 100);
    const matches = await db
      .select()
      .from(backlinkGapLinks)
      .where(inArray(backlinkGapLinks.referringDomainId, chunk));
    rows.push(...matches);
  }
  return rows;
}

async function replaceRun(input: BacklinkGapRunWrite) {
  const existing = await db
    .select({ id: backlinkGapRuns.id })
    .from(backlinkGapRuns)
    .where(
      and(
        eq(backlinkGapRuns.projectId, input.projectId),
        eq(backlinkGapRuns.fingerprint, input.fingerprint),
      ),
    );
  for (const run of existing) {
    await db.delete(backlinkGapRuns).where(eq(backlinkGapRuns.id, run.id));
  }

  await db.insert(backlinkGapRuns).values({
    id: input.id,
    projectId: input.projectId,
    fingerprint: input.fingerprint,
    fetchedAt: input.fetchedAt,
  });

  await executeInBatches(input.domains, (tx, domain) =>
    tx.insert(backlinkGapRunDomains).values({
      id: domain.id,
      runId: input.id,
      domain: domain.domain,
      role: domain.role,
      sortOrder: domain.sortOrder,
    }),
  );

  await executeInBatches(input.referringDomains, (tx, row) =>
    tx.insert(backlinkGapReferringDomains).values({
      id: row.id,
      runId: input.id,
      referringDomain: row.referringDomain,
      rank: row.rank,
      firstSeen: row.firstSeen,
      competitorCount: row.competitorCount,
    }),
  );

  const links = input.referringDomains.flatMap((row) =>
    row.competitorDomains.map((competitor) => ({
      id: competitor.id,
      referringDomainId: row.id,
      competitorDomain: competitor.domain,
    })),
  );
  await executeInBatches(links, (tx, link) =>
    tx.insert(backlinkGapLinks).values(link),
  );
}

export const BacklinkGapRepository = {
  findFreshRun,
  getRun,
  listDomains,
  listReferringDomains,
  listLinks,
  replaceRun,
};
