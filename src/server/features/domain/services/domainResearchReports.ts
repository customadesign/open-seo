import type { BillingCustomerContext } from "@/server/billing/subscription";
import {
  DomainResearchRepository,
  periodKeyFromDate,
} from "@/server/features/domain/repositories/DomainResearchRepository";
import {
  SEARCH_INTENTS,
  type PositionChangeKind,
  type SearchIntent,
} from "@/server/features/domain/services/domainKeywordMapper";
import {
  getRankedKeywordSample,
  trafficImpact,
  type MappedDomainKeyword,
} from "@/server/features/domain/services/domainKeywordSample";
import {
  deriveBrandTokensFromDomain,
  isBrandedKeyword,
} from "@/server/features/domain/services/domainBrandTokens";

type DomainReportInput = {
  projectId: string;
  domain: string;
  includeSubdomains: boolean;
  locationCode: number;
  languageCode: string;
};

export async function getPositionChanges(
  input: DomainReportInput,
  billingCustomer: BillingCustomerContext,
) {
  const sample = await getRankedKeywordSample(input, billingCustomer);
  const rows = [...sample.live, ...sample.lost]
    .filter(
      (item): item is MappedDomainKeyword & { change: PositionChangeKind } =>
        item.change != null,
    )
    .map((item) => ({
      keyword: item.keyword,
      change: item.change,
      previousPosition: item.previousPosition,
      currentPosition: item.change === "lost" ? null : item.position,
      searchVolume: item.searchVolume,
      traffic: item.traffic,
      trafficImpact: trafficImpact(
        item.previousPosition,
        item.change === "lost" ? null : item.position,
        item.searchVolume,
      ),
    }));

  const counts = {
    new: 0,
    lost: 0,
    improved: 0,
    declined: 0,
  };
  for (const row of rows) counts[row.change] += 1;

  return {
    domain: sample.domain,
    currentDate: sample.lastUpdatedTime,
    previousDate: sample.previousUpdatedTime,
    sampleSize: sample.live.length + sample.lost.length,
    counts,
    keywords: rows,
    fetchedAt: sample.fetchedAt,
  };
}

export async function getKeywordsByIntent(
  input: DomainReportInput,
  billingCustomer: BillingCustomerContext,
) {
  const sample = await getRankedKeywordSample(input, billingCustomer);
  const buckets: Record<
    SearchIntent,
    { intent: SearchIntent; keywordCount: number; traffic: number }
  > = {
    informational: { intent: "informational", keywordCount: 0, traffic: 0 },
    navigational: { intent: "navigational", keywordCount: 0, traffic: 0 },
    commercial: { intent: "commercial", keywordCount: 0, traffic: 0 },
    transactional: { intent: "transactional", keywordCount: 0, traffic: 0 },
  };
  let unclassified = 0;

  for (const item of sample.live) {
    if (item.intent == null) {
      unclassified += 1;
      continue;
    }
    buckets[item.intent].keywordCount += 1;
    buckets[item.intent].traffic += item.traffic ?? 0;
  }

  return {
    domain: sample.domain,
    sampleSize: sample.live.length,
    buckets: SEARCH_INTENTS.map((intent) => ({
      ...buckets[intent],
      traffic: Math.round(buckets[intent].traffic),
    })),
    unclassified,
    fetchedAt: sample.fetchedAt,
  };
}

export async function getSerpFeatures(
  input: DomainReportInput,
  billingCustomer: BillingCustomerContext,
) {
  const sample = await getRankedKeywordSample(input, billingCustomer);
  const byFeature = new Map<
    string,
    { feature: string; triggeredCount: number; occupiedCount: number }
  >();

  for (const item of sample.live) {
    const triggered = new Set(item.serpFeatures);
    for (const feature of triggered) {
      const row = byFeature.get(feature) ?? {
        feature,
        triggeredCount: 0,
        occupiedCount: 0,
      };
      row.triggeredCount += 1;
      if (item.occupiedType === feature) row.occupiedCount += 1;
      byFeature.set(feature, row);
    }
    if (item.occupiedType && !triggered.has(item.occupiedType)) {
      const row = byFeature.get(item.occupiedType) ?? {
        feature: item.occupiedType,
        triggeredCount: 0,
        occupiedCount: 0,
      };
      row.occupiedCount += 1;
      byFeature.set(item.occupiedType, row);
    }
  }

  const current = [...byFeature.values()].toSorted(
    (a, b) => b.triggeredCount - a.triggeredCount,
  );

  const snapshotId = await DomainResearchRepository.upsertSnapshot(
    {
      projectId: input.projectId,
      domain: sample.domain,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      includeSubdomains: input.includeSubdomains,
      periodKey: periodKeyFromDate(),
    },
    { organicTraffic: null, organicKeywords: null, trafficCost: null },
  );
  await DomainResearchRepository.replaceSnapshotFeatures(
    snapshotId,
    current.map((row) => ({
      featureType: row.feature,
      triggeredCount: row.triggeredCount,
      occupiedCount: row.occupiedCount,
    })),
  );
  await DomainResearchRepository.prune(input.projectId);

  const snapshots = await DomainResearchRepository.listSnapshots({
    projectId: input.projectId,
    domain: sample.domain,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    includeSubdomains: input.includeSubdomains,
  });
  const featureRows = await DomainResearchRepository.listSnapshotFeatures(
    snapshots.map((snapshot) => snapshot.id),
  );
  const trend = snapshots.map((snapshot) => ({
    periodKey: snapshot.periodKey,
    features: featureRows
      .filter((row) => row.snapshotId === snapshot.id)
      .map((row) => ({
        feature: row.featureType,
        triggeredCount: row.triggeredCount,
        occupiedCount: row.occupiedCount,
      })),
  }));

  return {
    domain: sample.domain,
    sampleSize: sample.live.length,
    current,
    trend,
    fetchedAt: sample.fetchedAt,
  };
}

export async function getTrafficBreakdown(
  input: DomainReportInput,
  billingCustomer: BillingCustomerContext,
) {
  const sample = await getRankedKeywordSample(input, billingCustomer);
  const derived = deriveBrandTokensFromDomain(sample.domain);
  const stored = await DomainResearchRepository.listBrandTokens(
    input.projectId,
    sample.domain,
  );
  const user = stored.map((row) => row.token);
  const tokens = {
    domain: sample.domain,
    derived,
    user,
    all: [...new Set([...derived, ...user])].toSorted(),
  };

  let brandedTraffic = 0;
  let brandedKeywords = 0;
  let nonBrandedTraffic = 0;
  let nonBrandedKeywords = 0;
  let sampleTrafficCost = 0;

  for (const item of sample.live) {
    sampleTrafficCost += item.trafficCost ?? 0;
    if (isBrandedKeyword(item.keyword, tokens.all)) {
      brandedKeywords += 1;
      brandedTraffic += item.traffic ?? 0;
    } else {
      nonBrandedKeywords += 1;
      nonBrandedTraffic += item.traffic ?? 0;
    }
  }

  return {
    domain: sample.domain,
    sampleSize: sample.live.length,
    brandTokens: tokens,
    branded: {
      keywordCount: brandedKeywords,
      traffic: Math.round(brandedTraffic),
    },
    nonBranded: {
      keywordCount: nonBrandedKeywords,
      traffic: Math.round(nonBrandedTraffic),
    },
    sampleTrafficCost: Math.round(sampleTrafficCost * 100) / 100,
    fetchedAt: sample.fetchedAt,
  };
}
