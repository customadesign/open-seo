import { and, asc, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  domainBrandTokens,
  domainResearchPages,
  domainResearchSnapshots,
  domainSerpFeatureMonths,
} from "@/db/schema";
import { periodKeyMonthsAgo } from "@/server/features/domain/repositories/domainResearchPeriod";

export const DOMAIN_RESEARCH_RETENTION_MONTHS = 6;
export const DOMAIN_RESEARCH_MAX_DOMAINS_PER_PROJECT = 8;
export { periodKeyFromDate } from "@/server/features/domain/repositories/domainResearchPeriod";

type SnapshotKey = {
  projectId: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  includeSubdomains: boolean;
  periodKey: string;
};

type SnapshotMetrics = {
  organicTraffic: number | null;
  organicKeywords: number | null;
  trafficCost: number | null;
};

type PageSnapshotRow = {
  pageUrl: string;
  organicTraffic: number | null;
  keywords: number | null;
};

type FeatureSnapshotRow = {
  featureType: string;
  triggeredCount: number;
  occupiedCount: number;
};

async function listBrandTokens(projectId: string, domain: string) {
  return db
    .select()
    .from(domainBrandTokens)
    .where(
      and(
        eq(domainBrandTokens.projectId, projectId),
        eq(domainBrandTokens.domain, domain),
      ),
    )
    .orderBy(asc(domainBrandTokens.token));
}

async function addBrandToken(values: {
  id: string;
  projectId: string;
  domain: string;
  token: string;
}) {
  const [row] = await db
    .insert(domainBrandTokens)
    .values(values)
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}

async function removeBrandToken(input: {
  projectId: string;
  domain: string;
  token: string;
}) {
  await db
    .delete(domainBrandTokens)
    .where(
      and(
        eq(domainBrandTokens.projectId, input.projectId),
        eq(domainBrandTokens.domain, input.domain),
        eq(domainBrandTokens.token, input.token),
      ),
    );
}

async function findSnapshot(key: SnapshotKey) {
  const rows = await db
    .select()
    .from(domainResearchSnapshots)
    .where(
      and(
        eq(domainResearchSnapshots.projectId, key.projectId),
        eq(domainResearchSnapshots.domain, key.domain),
        eq(domainResearchSnapshots.locationCode, key.locationCode),
        eq(domainResearchSnapshots.languageCode, key.languageCode),
        eq(
          domainResearchSnapshots.includeSubdomains,
          key.includeSubdomains ? 1 : 0,
        ),
        eq(domainResearchSnapshots.periodKey, key.periodKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listSnapshots(input: {
  projectId: string;
  domain: string;
  locationCode: number;
  languageCode: string;
  includeSubdomains: boolean;
}) {
  return db
    .select()
    .from(domainResearchSnapshots)
    .where(
      and(
        eq(domainResearchSnapshots.projectId, input.projectId),
        eq(domainResearchSnapshots.domain, input.domain),
        eq(domainResearchSnapshots.locationCode, input.locationCode),
        eq(domainResearchSnapshots.languageCode, input.languageCode),
        eq(
          domainResearchSnapshots.includeSubdomains,
          input.includeSubdomains ? 1 : 0,
        ),
      ),
    )
    .orderBy(desc(domainResearchSnapshots.periodKey));
}

async function upsertSnapshot(
  key: SnapshotKey,
  metrics: SnapshotMetrics,
): Promise<string> {
  const existing = await findSnapshot(key);
  if (existing) {
    await db
      .update(domainResearchSnapshots)
      .set({
        organicTraffic: metrics.organicTraffic,
        organicKeywords: metrics.organicKeywords,
        trafficCost: metrics.trafficCost,
        capturedAt: new Date().toISOString(),
      })
      .where(eq(domainResearchSnapshots.id, existing.id));
    return existing.id;
  }

  const id = crypto.randomUUID();
  await db.insert(domainResearchSnapshots).values({
    id,
    projectId: key.projectId,
    domain: key.domain,
    locationCode: key.locationCode,
    languageCode: key.languageCode,
    includeSubdomains: key.includeSubdomains ? 1 : 0,
    periodKey: key.periodKey,
    organicTraffic: metrics.organicTraffic,
    organicKeywords: metrics.organicKeywords,
    trafficCost: metrics.trafficCost,
  });
  return id;
}

async function replaceSnapshotPages(
  snapshotId: string,
  pages: PageSnapshotRow[],
) {
  await db
    .delete(domainResearchPages)
    .where(eq(domainResearchPages.snapshotId, snapshotId));
  if (pages.length === 0) return;

  await runBatch((tx) =>
    pages.map((page) =>
      tx.insert(domainResearchPages).values({
        id: crypto.randomUUID(),
        snapshotId,
        pageUrl: page.pageUrl,
        organicTraffic: page.organicTraffic,
        keywords: page.keywords,
      }),
    ),
  );
}

async function replaceSnapshotFeatures(
  snapshotId: string,
  features: FeatureSnapshotRow[],
) {
  await db
    .delete(domainSerpFeatureMonths)
    .where(eq(domainSerpFeatureMonths.snapshotId, snapshotId));
  if (features.length === 0) return;

  await runBatch((tx) =>
    features.map((feature) =>
      tx.insert(domainSerpFeatureMonths).values({
        id: crypto.randomUUID(),
        snapshotId,
        featureType: feature.featureType,
        triggeredCount: feature.triggeredCount,
        occupiedCount: feature.occupiedCount,
      }),
    ),
  );
}

async function listSnapshotPages(snapshotId: string) {
  return db
    .select()
    .from(domainResearchPages)
    .where(eq(domainResearchPages.snapshotId, snapshotId))
    .orderBy(desc(domainResearchPages.organicTraffic));
}

async function listSnapshotFeatures(snapshotIds: string[]) {
  if (snapshotIds.length === 0) return [];
  return db
    .select()
    .from(domainSerpFeatureMonths)
    .where(inArray(domainSerpFeatureMonths.snapshotId, snapshotIds));
}

async function prune(projectId: string) {
  const cutoff = periodKeyMonthsAgo(DOMAIN_RESEARCH_RETENTION_MONTHS);
  const stale = await db
    .select({ id: domainResearchSnapshots.id })
    .from(domainResearchSnapshots)
    .where(
      and(
        eq(domainResearchSnapshots.projectId, projectId),
        lt(domainResearchSnapshots.periodKey, cutoff),
      ),
    );
  if (stale.length > 0) {
    await db.delete(domainResearchSnapshots).where(
      inArray(
        domainResearchSnapshots.id,
        stale.map((row) => row.id),
      ),
    );
  }

  const remaining = await db
    .select({
      id: domainResearchSnapshots.id,
      domain: domainResearchSnapshots.domain,
      capturedAt: domainResearchSnapshots.capturedAt,
    })
    .from(domainResearchSnapshots)
    .where(eq(domainResearchSnapshots.projectId, projectId))
    .orderBy(desc(domainResearchSnapshots.capturedAt));

  const newestByDomain = new Map<string, string>();
  for (const row of remaining) {
    if (!newestByDomain.has(row.domain)) {
      newestByDomain.set(row.domain, row.capturedAt);
    }
  }

  if (newestByDomain.size <= DOMAIN_RESEARCH_MAX_DOMAINS_PER_PROJECT) return;

  const keepDomains = [...newestByDomain.entries()]
    .toSorted((a, b) => b[1].localeCompare(a[1]))
    .slice(0, DOMAIN_RESEARCH_MAX_DOMAINS_PER_PROJECT)
    .map(([domain]) => domain);

  await db
    .delete(domainResearchSnapshots)
    .where(
      and(
        eq(domainResearchSnapshots.projectId, projectId),
        notInArray(domainResearchSnapshots.domain, keepDomains),
      ),
    );
}

export const DomainResearchRepository = {
  listBrandTokens,
  addBrandToken,
  removeBrandToken,
  findSnapshot,
  listSnapshots,
  upsertSnapshot,
  replaceSnapshotPages,
  replaceSnapshotFeatures,
  listSnapshotPages,
  listSnapshotFeatures,
  prune,
};
