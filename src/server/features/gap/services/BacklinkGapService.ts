import { AppError } from "@/server/lib/errors";
import { normalizeDomainInput } from "@/server/lib/domainUtils";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { BacklinksService } from "@/server/features/backlinks/services/BacklinksService";
import type { ReferringDomainsSnapshot } from "@/server/features/backlinks/services/backlinksSnapshot";
import { BacklinkGapRepository } from "@/server/features/gap/repositories/BacklinkGapRepository";
import {
  BACKLINK_GAP_TTL_MS,
  MAX_BACKLINK_GAP_COMPETITORS,
  buildGapFingerprint,
  estimateBacklinkGapCredits,
  gapCostApprovalError,
} from "@/shared/gap";

export type BacklinkGapRow = {
  referringDomain: string;
  rank: number | null;
  firstSeen: string | null;
  competitorCount: number;
  competitorDomains: string[];
};

type SnapshotFn = typeof BacklinksService.profileReferringDomainsSnapshot;
type HasSnapshotFn = typeof BacklinksService.hasReferringDomainsSnapshot;

type BacklinkGapRepo = Pick<
  typeof BacklinkGapRepository,
  | "findFreshRun"
  | "getRun"
  | "listDomains"
  | "listReferringDomains"
  | "listLinks"
  | "replaceRun"
>;

function createBacklinkGapService(
  deps: {
    getSnapshot?: SnapshotFn;
    hasSnapshot?: HasSnapshotFn;
    repo?: BacklinkGapRepo;
  } = {},
) {
  const getSnapshot =
    deps.getSnapshot ??
    BacklinksService.profileReferringDomainsSnapshot.bind(BacklinksService);
  const hasSnapshot =
    deps.hasSnapshot ??
    BacklinksService.hasReferringDomainsSnapshot.bind(BacklinksService);
  const repo = deps.repo ?? BacklinkGapRepository;

  return {
    estimate,
    run,
    getResults,
  };

  async function estimate(
    input: BacklinkGapCompareInput,
    billingCustomer: BillingCustomerContext,
  ) {
    const comparison = normalizeBacklinkGapInput(input);
    const fresh = await repo.findFreshRun({
      projectId: input.projectId,
      fingerprint: comparison.fingerprint,
      fetchedAfter: freshAfter(BACKLINK_GAP_TTL_MS),
    });
    if (fresh) {
      return {
        ...estimateBacklinkGapCredits(0),
        domainCount: comparison.domains.length,
        cachedDomainCount: comparison.domains.length,
        billedDomainCount: 0,
        fromCache: true,
      };
    }

    const cacheFlags = await Promise.all(
      comparison.domains.map((domain) =>
        hasSnapshot({ target: domain, scope: "domain" }, billingCustomer),
      ),
    );
    const cachedDomainCount = cacheFlags.filter(Boolean).length;
    const billedDomainCount = comparison.domains.length - cachedDomainCount;
    return {
      ...estimateBacklinkGapCredits(billedDomainCount),
      domainCount: comparison.domains.length,
      cachedDomainCount,
      billedDomainCount,
      fromCache: billedDomainCount === 0,
    };
  }

  async function run(
    input: BacklinkGapCompareInput & { maxCostCredits?: number },
    billingCustomer: BillingCustomerContext,
  ) {
    const comparison = normalizeBacklinkGapInput(input);
    const existing = await repo.findFreshRun({
      projectId: input.projectId,
      fingerprint: comparison.fingerprint,
      fetchedAfter: freshAfter(BACKLINK_GAP_TTL_MS),
    });
    if (existing) {
      return getResults({
        projectId: input.projectId,
        runId: existing.id,
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
        getSnapshot({ target: domain, scope: "domain" }, billingCustomer),
      ),
    );

    const runId = crypto.randomUUID();
    const fetchedAt = new Date().toISOString();
    const rows = assembleBacklinkRows(comparison.domains, snapshots);

    await repo.replaceRun({
      id: runId,
      projectId: input.projectId,
      fingerprint: comparison.fingerprint,
      fetchedAt,
      domains: comparison.domains.map((domain, index) => ({
        id: crypto.randomUUID(),
        domain,
        role: index === 0 ? "base" : "competitor",
        sortOrder: index,
      })),
      referringDomains: rows.map((row) => ({
        id: crypto.randomUUID(),
        referringDomain: row.referringDomain,
        rank: row.rank,
        firstSeen: row.firstSeen,
        competitorCount: row.competitorCount,
        competitorDomains: row.competitorDomains.map((domain) => ({
          id: crypto.randomUUID(),
          domain,
        })),
      })),
    });

    return getResults({
      projectId: input.projectId,
      runId,
    });
  }

  async function getResults(input: { projectId: string; runId: string }) {
    const storedRun = await repo.getRun({
      projectId: input.projectId,
      runId: input.runId,
    });
    if (!storedRun) {
      throw new AppError("NOT_FOUND", "Backlink gap comparison not found");
    }

    const [domains, referringDomains] = await Promise.all([
      repo.listDomains(storedRun.id),
      repo.listReferringDomains(storedRun.id),
    ]);
    const links = await repo.listLinks(referringDomains.map((row) => row.id));
    const linksByReferring = new Map<string, string[]>();
    for (const link of links) {
      const current = linksByReferring.get(link.referringDomainId) ?? [];
      current.push(link.competitorDomain);
      linksByReferring.set(link.referringDomainId, current);
    }

    const rows: BacklinkGapRow[] = referringDomains.map((row) => ({
      referringDomain: row.referringDomain,
      rank: row.rank,
      firstSeen: row.firstSeen,
      competitorCount: row.competitorCount,
      competitorDomains: linksByReferring.get(row.id) ?? [],
    }));

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
      totalCount: rows.length,
      rows,
    };
  }
}

export type BacklinkGapCompareInput = {
  projectId: string;
  baseDomain: string;
  competitorDomains: string[];
};

function normalizeBacklinkGapInput(input: BacklinkGapCompareInput) {
  const baseDomain = normalizeDomainInput(input.baseDomain, true);
  const competitorDomains = [
    ...new Set(
      input.competitorDomains.map((domain) =>
        normalizeDomainInput(domain, true),
      ),
    ),
  ].filter((domain) => domain !== baseDomain);

  if (competitorDomains.length < 1) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Add at least one competitor domain",
    );
  }
  if (competitorDomains.length > MAX_BACKLINK_GAP_COMPETITORS) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Compare at most ${MAX_BACKLINK_GAP_COMPETITORS} competitor domains`,
    );
  }

  return {
    baseDomain,
    competitorDomains,
    domains: [baseDomain, ...competitorDomains],
    fingerprint: buildGapFingerprint({
      baseDomain,
      competitorDomains,
    }),
  };
}

function assembleBacklinkRows(
  domains: string[],
  snapshots: ReferringDomainsSnapshot[],
): BacklinkGapRow[] {
  const [baseDomain, ...competitorDomains] = domains;
  const baseSet = new Set(
    (snapshots[0]?.rows ?? [])
      .map((row) => row.domain)
      .filter((domain): domain is string => Boolean(domain)),
  );

  const byReferring = new Map<
    string,
    {
      rank: number | null;
      firstSeen: string | null;
      competitorDomains: Set<string>;
    }
  >();

  for (const [index, snapshot] of snapshots.entries()) {
    if (index === 0) continue;
    const competitor = competitorDomains[index - 1];
    if (!competitor) continue;
    for (const row of snapshot.rows) {
      if (!row.domain || baseSet.has(row.domain) || row.domain === baseDomain) {
        continue;
      }
      const current = byReferring.get(row.domain) ?? {
        rank: row.rank,
        firstSeen: row.firstSeen,
        competitorDomains: new Set<string>(),
      };
      current.competitorDomains.add(competitor);
      current.rank = current.rank ?? row.rank;
      if (
        row.firstSeen &&
        (!current.firstSeen || row.firstSeen < current.firstSeen)
      ) {
        current.firstSeen = row.firstSeen;
      }
      byReferring.set(row.domain, current);
    }
  }

  return [...byReferring.entries()].map(([referringDomain, row]) => ({
    referringDomain,
    rank: row.rank,
    firstSeen: row.firstSeen,
    competitorCount: row.competitorDomains.size,
    competitorDomains: [...row.competitorDomains],
  }));
}

function freshAfter(ttlMs: number) {
  return new Date(Date.now() - ttlMs).toISOString();
}

export const BacklinkGapService = createBacklinkGapService();
export { createBacklinkGapService };
