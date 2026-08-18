import type {
  BacklinksItem,
  ReferringDomainItem,
} from "@/server/lib/dataforseo/backlinks";
import {
  ipv4Subnet,
  scoreBacklinkToxicity,
  scoreDomainToxicity,
  type ToxicMarker,
} from "@/shared/backlink-toxicity";

export const REFERRING_PAGE_SIZE = 1000;
export const BACKLINK_PAGE_SIZE = 1000;
export const MAX_REFERRING_DOMAINS = 5_000;
export const MAX_BACKLINKS = 10_000;
const RECENT_LINK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type DomainAccumulator = {
  domain: string;
  backlinkCount: number;
  brokenBacklinkCount: number;
  rank: number | null;
  spamScore: number | null;
  recentLinkCount: number;
  maxBacklinkScore: number;
  markers: ToxicMarker[];
  subnet: string | null;
  countedFromReferring: boolean;
};

export type BacklinksAuditClient = {
  backlinks: {
    referringDomains: (input: {
      target: string;
      limit: number;
      offset: number;
      hideSpam: boolean;
    }) => Promise<{ items: ReferringDomainItem[]; totalCount: number | null }>;
    rows: (input: {
      target: string;
      limit: number;
      offset: number;
      hideSpam: boolean;
      mode: string;
    }) => Promise<{ items: BacklinksItem[]; totalCount: number | null }>;
  };
};

export async function collectReferringDomains(
  client: BacklinksAuditClient,
  target: string,
) {
  const referring = new Map<string, ReferringDomainItem>();
  let offset = 0;
  let truncated = false;
  while (offset < MAX_REFERRING_DOMAINS) {
    const page = await client.backlinks.referringDomains({
      target,
      limit: REFERRING_PAGE_SIZE,
      offset,
      hideSpam: false,
    });
    for (const item of page.items) {
      const domain = normalizeHost(item.domain);
      if (domain) referring.set(domain, item);
    }
    offset += page.items.length;
    if (page.items.length < REFERRING_PAGE_SIZE) break;
    if ((page.totalCount ?? 0) > MAX_REFERRING_DOMAINS) truncated = true;
    if (page.items.length === 0) break;
  }
  if (offset >= MAX_REFERRING_DOMAINS) truncated = true;
  return { domains: referring, truncated };
}

export async function collectBacklinkSignals(input: {
  client: BacklinksAuditClient;
  target: string;
  referring: Map<string, ReferringDomainItem>;
  targetLanguage: string;
  targetHost: string;
  now: Date;
}) {
  const byDomain = new Map<string, DomainAccumulator>();
  for (const [domain, item] of input.referring) {
    byDomain.set(domain, createAccumulator(domain, item));
  }

  let offset = 0;
  let truncated = false;
  while (offset < MAX_BACKLINKS) {
    const page = await input.client.backlinks.rows({
      target: input.target,
      limit: BACKLINK_PAGE_SIZE,
      offset,
      hideSpam: false,
      mode: "as_is",
    });
    for (const item of page.items) {
      absorbBacklink(byDomain, item, input);
    }
    offset += page.items.length;
    if (page.items.length < BACKLINK_PAGE_SIZE) break;
    if ((page.totalCount ?? 0) > MAX_BACKLINKS) truncated = true;
    if (page.items.length === 0) break;
  }
  if (offset >= MAX_BACKLINKS) truncated = true;

  return { byDomain, truncated };
}

export function scoreAccumulatedDomains(
  byDomain: Map<string, DomainAccumulator>,
) {
  const subnetSizes = new Map<string, number>();
  for (const acc of byDomain.values()) {
    if (!acc.subnet) continue;
    subnetSizes.set(acc.subnet, (subnetSizes.get(acc.subnet) ?? 0) + 1);
  }

  return [...byDomain.values()].map((acc) => {
    const scored = scoreDomainToxicity({
      domain: acc.domain,
      backlinkCount: acc.backlinkCount,
      brokenBacklinkCount: acc.brokenBacklinkCount,
      rank: acc.rank,
      spamScore: acc.spamScore,
      recentLinkCount: acc.recentLinkCount,
      subnetDomainCount: acc.subnet ? (subnetSizes.get(acc.subnet) ?? 0) : 0,
      maxBacklinkScore: acc.maxBacklinkScore,
      backlinkMarkers: acc.markers,
    });
    return {
      domain: acc.domain,
      score: scored.score,
      verdict: scored.verdict,
      classification: scored.classification,
      backlinkCount: acc.backlinkCount,
      brokenBacklinkCount: acc.brokenBacklinkCount,
      rank: acc.rank,
      spamScore: acc.spamScore,
      markers: scored.markers,
    };
  });
}

function absorbBacklink(
  byDomain: Map<string, DomainAccumulator>,
  item: BacklinksItem,
  input: {
    targetLanguage: string;
    targetHost: string;
    now: Date;
  },
) {
  const domain = normalizeHost(item.domain_from);
  if (!domain) return;
  let acc = byDomain.get(domain);
  if (!acc) {
    acc = createAccumulator(domain, null);
    byDomain.set(domain, acc);
  }
  if (!acc.countedFromReferring) acc.backlinkCount += 1;
  if (item.is_broken && !acc.countedFromReferring) {
    acc.brokenBacklinkCount += 1;
  }
  if (item.domain_from_rank != null) {
    acc.rank = Math.max(acc.rank ?? 0, item.domain_from_rank);
  }
  const spam = item.backlink_spam_score ?? item.backlinks_spam_score ?? null;
  if (spam != null) acc.spamScore = Math.max(acc.spamScore ?? 0, spam);
  if (isRecent(item.first_seen, input.now)) acc.recentLinkCount += 1;

  const scored = scoreBacklinkToxicity({
    domainFrom: domain,
    urlFrom: item.url_from,
    anchor: item.anchor,
    domainFromRank: item.domain_from_rank,
    spamScore: spam,
    pageLanguage: item.page_from_language,
    targetLanguage: input.targetLanguage,
    targetHost: input.targetHost,
    semanticLocation: item.semantic_location,
    linksCount: item.links_count,
    domainFromIp: item.domain_from_ip,
    tldFrom: item.tld_from,
    isBroken: item.is_broken,
  });
  acc.maxBacklinkScore = Math.max(acc.maxBacklinkScore, scored.score);
  acc.markers.push(...scored.markers);

  const subnet = ipv4Subnet(item.domain_from_ip);
  if (subnet) acc.subnet = subnet;
}

function createAccumulator(
  domain: string,
  item: ReferringDomainItem | null,
): DomainAccumulator {
  return {
    domain,
    backlinkCount: item?.backlinks ?? 0,
    brokenBacklinkCount: item?.broken_backlinks ?? 0,
    rank: item?.rank ?? null,
    spamScore: item?.backlinks_spam_score ?? item?.target_spam_score ?? null,
    recentLinkCount: 0,
    maxBacklinkScore: 0,
    markers: [],
    subnet: null,
    countedFromReferring: item != null,
  };
}

function normalizeHost(value: string | null | undefined) {
  if (!value) return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

function isRecent(value: string | null | undefined, now: Date) {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return now.getTime() - parsed <= RECENT_LINK_WINDOW_MS;
}
