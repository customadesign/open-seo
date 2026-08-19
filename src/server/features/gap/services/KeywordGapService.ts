import { AppError } from "@/server/lib/errors";
import { normalizeDomainInput } from "@/server/lib/domainUtils";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { DomainService } from "@/server/features/domain/services/DomainService";
import { KeywordGapRepository } from "@/server/features/gap/repositories/KeywordGapRepository";
import type { KeywordSnapshot } from "@/server/features/domain/services/domainKeywordsPage";
import {
  KEYWORD_GAP_TTL_MS,
  MAX_KEYWORD_GAP_COMPETITORS,
  buildGapFingerprint,
  classifyKeywordGap,
  estimateKeywordGapCredits,
  gapCostApprovalError,
  keywordMatchesTerms,
  parseGapFilterTerms,
  type KeywordGapClassification,
} from "@/shared/gap";

export type KeywordGapKeywordRow = {
  keyword: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  intent: string | null;
  cpc: number | null;
  classification: KeywordGapClassification;
  positions: Record<string, number | null>;
};

type KeywordSnapshotFn = typeof DomainService.getKeywordsSnapshot;
type HasKeywordSnapshotFn = typeof DomainService.hasKeywordsSnapshot;

type KeywordGapRepo = Pick<
  typeof KeywordGapRepository,
  | "findFreshRun"
  | "getRun"
  | "listDomains"
  | "listKeywords"
  | "listPositions"
  | "replaceRun"
>;

function createKeywordGapService(
  deps: {
    getSnapshot?: KeywordSnapshotFn;
    hasSnapshot?: HasKeywordSnapshotFn;
    repo?: KeywordGapRepo;
  } = {},
) {
  const getSnapshot = deps.getSnapshot ?? DomainService.getKeywordsSnapshot;
  const hasSnapshot = deps.hasSnapshot ?? DomainService.hasKeywordsSnapshot;
  const repo = deps.repo ?? KeywordGapRepository;

  return {
    estimate,
    run,
    getResults,
  };

  async function estimate(
    input: KeywordGapCompareInput,
    billingCustomer: BillingCustomerContext,
  ) {
    const comparison = normalizeKeywordGapInput(input);
    const fresh = await repo.findFreshRun({
      projectId: input.projectId,
      fingerprint: comparison.fingerprint,
      fetchedAfter: freshAfter(KEYWORD_GAP_TTL_MS),
    });
    if (fresh) {
      return {
        ...estimateKeywordGapCredits(0),
        domainCount: comparison.domains.length,
        cachedDomainCount: comparison.domains.length,
        billedDomainCount: 0,
        fromCache: true,
      };
    }

    const cacheFlags = await Promise.all(
      comparison.domains.map((domain) =>
        hasSnapshot(
          {
            projectId: input.projectId,
            domain,
            includeSubdomains: comparison.includeSubdomains,
            locationCode: comparison.locationCode,
            languageCode: comparison.languageCode,
          },
          billingCustomer,
        ),
      ),
    );
    const cachedDomainCount = cacheFlags.filter(Boolean).length;
    const billedDomainCount = comparison.domains.length - cachedDomainCount;
    return {
      ...estimateKeywordGapCredits(billedDomainCount),
      domainCount: comparison.domains.length,
      cachedDomainCount,
      billedDomainCount,
      fromCache: billedDomainCount === 0,
    };
  }

  async function run(
    input: KeywordGapCompareInput & { maxCostCredits?: number },
    billingCustomer: BillingCustomerContext,
  ) {
    const comparison = normalizeKeywordGapInput(input);
    const existing = await repo.findFreshRun({
      projectId: input.projectId,
      fingerprint: comparison.fingerprint,
      fetchedAfter: freshAfter(KEYWORD_GAP_TTL_MS),
    });
    if (existing) {
      return getResults({
        projectId: input.projectId,
        runId: existing.id,
        filters: input.filters,
      });
    }

    const quote = await estimate(input, billingCustomer);
    if (
      quote.costCredits > 0 &&
      (input.maxCostCredits == null || quote.costCredits > input.maxCostCredits)
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        gapCostApprovalError(quote.costCredits, input.maxCostCredits ?? 0),
      );
    }

    const snapshots = await Promise.all(
      comparison.domains.map((domain) =>
        getSnapshot(
          {
            projectId: input.projectId,
            domain,
            includeSubdomains: comparison.includeSubdomains,
            locationCode: comparison.locationCode,
            languageCode: comparison.languageCode,
          },
          billingCustomer,
        ),
      ),
    );

    const runId = crypto.randomUUID();
    const fetchedAt = new Date().toISOString();
    await repo.replaceRun({
      id: runId,
      projectId: input.projectId,
      fingerprint: comparison.fingerprint,
      locationCode: comparison.locationCode,
      languageCode: comparison.languageCode,
      includeSubdomains: comparison.includeSubdomains,
      fetchedAt,
      domains: comparison.domains.map((domain, index) => ({
        id: crypto.randomUUID(),
        domain,
        role: index === 0 ? "base" : "competitor",
        sortOrder: index,
      })),
      keywords: assembleKeywordRows(comparison.domains, snapshots).map(
        (row) => ({
          id: crypto.randomUUID(),
          keyword: row.keyword,
          searchVolume: row.searchVolume,
          keywordDifficulty: row.keywordDifficulty,
          intent: row.intent,
          cpc: row.cpc,
          classification: row.classification,
          positions: comparison.domains.map((domain) => ({
            id: crypto.randomUUID(),
            domain,
            position: row.positions[domain] ?? null,
          })),
        }),
      ),
    });

    return getResults({
      projectId: input.projectId,
      runId,
      filters: input.filters,
    });
  }

  async function getResults(input: {
    projectId: string;
    runId: string;
    filters?: KeywordGapResultFilters;
  }) {
    const storedRun = await repo.getRun({
      projectId: input.projectId,
      runId: input.runId,
    });
    if (!storedRun) {
      throw new AppError("NOT_FOUND", "Keyword gap comparison not found");
    }

    const [domains, keywords] = await Promise.all([
      repo.listDomains(storedRun.id),
      repo.listKeywords(storedRun.id),
    ]);
    const positions = await repo.listPositions(keywords.map((row) => row.id));
    const positionsByKeyword = new Map<string, Record<string, number | null>>();
    for (const position of positions) {
      const current = positionsByKeyword.get(position.keywordId) ?? {};
      current[position.domain] = position.position;
      positionsByKeyword.set(position.keywordId, current);
    }

    const rows = keywords.map((keyword) => ({
      keyword: keyword.keyword,
      searchVolume: keyword.searchVolume,
      keywordDifficulty: keyword.keywordDifficulty,
      intent: keyword.intent,
      cpc: keyword.cpc,
      classification: keyword.classification,
      positions: positionsByKeyword.get(keyword.id) ?? {},
    }));

    const filtered = filterKeywordRows(rows, input.filters);
    const sortedDomains = domains.toSorted(
      (left, right) => left.sortOrder - right.sortOrder,
    );

    return {
      runId: storedRun.id,
      fetchedAt: storedRun.fetchedAt,
      baseDomain: sortedDomains.find((domain) => domain.role === "base")
        ?.domain,
      competitorDomains: sortedDomains
        .filter((domain) => domain.role === "competitor")
        .map((domain) => domain.domain),
      locationCode: storedRun.locationCode,
      languageCode: storedRun.languageCode,
      includeSubdomains: storedRun.includeSubdomains,
      totalCount: filtered.length,
      rows: filtered,
    };
  }
}

export type KeywordGapResultFilters = {
  classifications?: KeywordGapClassification[];
  minVolume?: number;
  maxVolume?: number;
  minDifficulty?: number;
  maxDifficulty?: number;
  intents?: string[];
  include?: string;
  exclude?: string;
};

export type KeywordGapCompareInput = {
  projectId: string;
  baseDomain: string;
  competitorDomains: string[];
  includeSubdomains: boolean;
  locationCode: number;
  languageCode: string;
  filters?: KeywordGapResultFilters;
};

function normalizeKeywordGapInput(input: KeywordGapCompareInput) {
  const includeSubdomains = input.includeSubdomains;
  const baseDomain = normalizeDomainInput(input.baseDomain, includeSubdomains);
  const competitorDomains = uniqueDomains(
    input.competitorDomains.map((domain) =>
      normalizeDomainInput(domain, includeSubdomains),
    ),
  ).filter((domain) => domain !== baseDomain);

  if (competitorDomains.length < 1) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Add at least one competitor domain",
    );
  }
  if (competitorDomains.length > MAX_KEYWORD_GAP_COMPETITORS) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Compare at most ${MAX_KEYWORD_GAP_COMPETITORS} competitor domains`,
    );
  }

  return {
    baseDomain,
    competitorDomains,
    domains: [baseDomain, ...competitorDomains],
    includeSubdomains,
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    fingerprint: buildGapFingerprint({
      baseDomain,
      competitorDomains,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      includeSubdomains,
    }),
  };
}

function assembleKeywordRows(
  domains: string[],
  snapshots: KeywordSnapshot[],
): KeywordGapKeywordRow[] {
  const byKeyword = new Map<
    string,
    {
      searchVolume: number | null;
      keywordDifficulty: number | null;
      intent: string | null;
      cpc: number | null;
      positions: Record<string, number | null>;
    }
  >();

  for (const [index, snapshot] of snapshots.entries()) {
    const domain = domains[index];
    if (!domain) continue;
    for (const item of snapshot.keywords) {
      const current = byKeyword.get(item.keyword) ?? {
        searchVolume: item.searchVolume,
        keywordDifficulty: item.keywordDifficulty,
        intent: item.intent,
        cpc: item.cpc,
        positions: Object.fromEntries(domains.map((name) => [name, null])),
      };
      current.positions[domain] = item.position;
      current.searchVolume = current.searchVolume ?? item.searchVolume;
      current.keywordDifficulty =
        current.keywordDifficulty ?? item.keywordDifficulty;
      current.intent = current.intent ?? item.intent;
      current.cpc = current.cpc ?? item.cpc;
      byKeyword.set(item.keyword, current);
    }
  }

  const [baseDomain, ...competitorDomains] = domains;
  return [...byKeyword.entries()].map(([keyword, row]) => ({
    keyword,
    searchVolume: row.searchVolume,
    keywordDifficulty: row.keywordDifficulty,
    intent: row.intent,
    cpc: row.cpc,
    classification: classifyKeywordGap({
      basePosition: baseDomain ? (row.positions[baseDomain] ?? null) : null,
      competitorPositions: competitorDomains.map(
        (domain) => row.positions[domain] ?? null,
      ),
    }),
    positions: row.positions,
  }));
}

function filterKeywordRows(
  rows: KeywordGapKeywordRow[],
  filters?: KeywordGapResultFilters,
) {
  if (!filters) return rows;
  const include = parseGapFilterTerms(filters.include);
  const exclude = parseGapFilterTerms(filters.exclude);
  return rows.filter((row) => {
    if (
      filters.classifications &&
      filters.classifications.length > 0 &&
      !filters.classifications.includes(row.classification)
    ) {
      return false;
    }
    if (
      filters.minVolume != null &&
      (row.searchVolume == null || row.searchVolume < filters.minVolume)
    ) {
      return false;
    }
    if (
      filters.maxVolume != null &&
      (row.searchVolume == null || row.searchVolume > filters.maxVolume)
    ) {
      return false;
    }
    if (
      filters.minDifficulty != null &&
      (row.keywordDifficulty == null ||
        row.keywordDifficulty < filters.minDifficulty)
    ) {
      return false;
    }
    if (
      filters.maxDifficulty != null &&
      (row.keywordDifficulty == null ||
        row.keywordDifficulty > filters.maxDifficulty)
    ) {
      return false;
    }
    if (
      filters.intents &&
      filters.intents.length > 0 &&
      !filters.intents.includes(row.intent ?? "unknown")
    ) {
      return false;
    }
    return keywordMatchesTerms(row.keyword, include, exclude);
  });
}

function uniqueDomains(domains: string[]) {
  return [...new Set(domains)];
}

function freshAfter(ttlMs: number) {
  return new Date(Date.now() - ttlMs).toISOString();
}

export const KeywordGapService = createKeywordGapService();
export { createKeywordGapService };
