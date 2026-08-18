/* eslint-disable max-lines -- one module owns the deterministic toxicity model */
import { parse as parseTld } from "tldts";
import { classifyAnchorText } from "@/shared/backlinks";
import type { DisavowStatus } from "@/types/schemas/disavow";

export const TOXICITY_CLASSIFICATIONS = [
  "toxic",
  "potentially_toxic",
  "non_toxic",
] as const;
export type ToxicityClassification = (typeof TOXICITY_CLASSIFICATIONS)[number];

export const TOXICITY_VERDICTS = ["low", "medium", "high"] as const;
export type ToxicityVerdict = (typeof TOXICITY_VERDICTS)[number];

export const TOXIC_MARKER_CODES = [
  "free_subdomain",
  "spam_tld",
  "provider_spam_score",
  "exact_match_commercial_anchor",
  "adult_anchor",
  "pharma_anchor",
  "gambling_anchor",
  "language_mismatch",
  "low_authority",
  "high_links_per_domain",
  "sitewide_footer",
  "subnet_cluster",
  "velocity_spike",
] as const;
export type ToxicMarkerCode = (typeof TOXIC_MARKER_CODES)[number];

export type ToxicMarker = {
  code: ToxicMarkerCode;
  points: number;
  detail: string;
};

export type ToxicityScore = {
  score: number;
  classification: ToxicityClassification;
  verdict: ToxicityVerdict;
  markers: ToxicMarker[];
};

export const TOXIC_SCORE_THRESHOLD = 60;
export const POTENTIALLY_TOXIC_SCORE_THRESHOLD = 35;
export const HIGH_PROFILE_TOXIC_PERCENT = 15;
export const MEDIUM_PROFILE_TOXIC_PERCENT = 5;
export const SUBNET_CLUSTER_MIN_DOMAINS = 5;
export const VELOCITY_SPIKE_MIN_LINKS = 10;
export const HIGH_LINKS_PER_DOMAIN = 15;
export const SITEWIDE_LINKS_COUNT = 20;
export const LOW_AUTHORITY_RANK = 15;

export const EXPORTABLE_DISAVOW_STATUSES = ["disavowed", "exported"] as const;

export const TOXIC_MARKER_LABELS: Record<ToxicMarkerCode, string> = {
  free_subdomain: "Free-subdomain host",
  spam_tld: "Spam-prone TLD",
  provider_spam_score: "Provider spam score",
  exact_match_commercial_anchor: "Exact-match commercial anchor",
  adult_anchor: "Adult-term anchor",
  pharma_anchor: "Pharma-term anchor",
  gambling_anchor: "Gambling-term anchor",
  language_mismatch: "Language mismatch vs target site",
  low_authority: "Low referring-domain authority",
  high_links_per_domain: "High links-per-domain volume",
  sitewide_footer: "Sitewide or footer link pattern",
  subnet_cluster: "Subnet or IP cluster",
  velocity_spike: "Link-velocity spike",
};

const FREE_SUBDOMAIN_REGISTRABLE = new Set([
  "firebaseapp.com",
  "web.app",
  "blogspot.com",
  "github.io",
  "gitlab.io",
  "wordpress.com",
  "weebly.com",
  "wixsite.com",
  "squarespace.com",
  "tumblr.com",
  "herokuapp.com",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "googleusercontent.com",
  "azurewebsites.net",
]);

const SPAM_TLDS = new Set([
  "xyz",
  "top",
  "click",
  "gq",
  "tk",
  "ml",
  "cf",
  "ga",
  "work",
  "rest",
  "fit",
  "cam",
  "icu",
  "buzz",
  "monster",
  "quest",
  "cyou",
  "sbs",
  "cfd",
  "zip",
  "mov",
  "stream",
  "download",
  "loan",
  "win",
  "review",
  "party",
  "science",
  "date",
  "faith",
  "accountant",
  "bid",
  "gdn",
]);

const ADULT_TERMS = ["porn", "xxx", "sex", "escort", "nude", "nsfw"] as const;
const PHARMA_TERMS = [
  "viagra",
  "cialis",
  "tramadol",
  "xanax",
  "phentermine",
] as const;
const GAMBLING_TERMS = [
  "casino",
  "poker",
  "betting",
  "gambling",
  "jackpot",
  "slots",
] as const;
const COMMERCIAL_EXACT_TERMS = [
  "buy",
  "cheap",
  "best",
  "discount",
  "order",
  "seo",
  "backlinks",
  "guest post",
  "link building",
] as const;

const SITEWIDE_LOCATIONS = new Set([
  "footer",
  "sidebar",
  "nav",
  "navigation",
  "menu",
  "copyright",
]);

export type BacklinkToxicitySignals = {
  domainFrom: string | null | undefined;
  urlFrom?: string | null;
  anchor?: string | null;
  domainFromRank?: number | null;
  spamScore?: number | null;
  pageLanguage?: string | null;
  targetLanguage?: string | null;
  targetHost?: string | null;
  semanticLocation?: string | null;
  linksCount?: number | null;
  domainFromIp?: string | null;
  tldFrom?: string | null;
  isBroken?: boolean | null;
};

export type DomainToxicitySignals = {
  domain: string;
  backlinkCount: number;
  brokenBacklinkCount?: number;
  rank?: number | null;
  spamScore?: number | null;
  recentLinkCount?: number;
  subnetDomainCount?: number;
  maxBacklinkScore?: number;
  backlinkMarkers?: ToxicMarker[];
  sample?: BacklinkToxicitySignals;
};

export function classifyToxicityScore(score: number): ToxicityClassification {
  if (score >= TOXIC_SCORE_THRESHOLD) return "toxic";
  if (score >= POTENTIALLY_TOXIC_SCORE_THRESHOLD) return "potentially_toxic";
  return "non_toxic";
}

export function verdictFromScore(score: number): ToxicityVerdict {
  if (score >= TOXIC_SCORE_THRESHOLD) return "high";
  if (score >= POTENTIALLY_TOXIC_SCORE_THRESHOLD) return "medium";
  return "low";
}

export function isExportableDisavowStatus(
  status: DisavowStatus | null | undefined,
): boolean {
  return status === "disavowed" || status === "exported";
}

export function isWhitelistedDisavowStatus(
  status: DisavowStatus | null | undefined,
): boolean {
  return status === "kept";
}

export function isDisavowCandidate(input: {
  classification: ToxicityClassification;
  status?: DisavowStatus | null;
}): boolean {
  if (isWhitelistedDisavowStatus(input.status)) return false;
  if (isExportableDisavowStatus(input.status)) return false;
  return input.classification !== "non_toxic";
}

export function selectExportableAuditRows<
  T extends {
    domain: string;
    classification: ToxicityClassification;
    status?: DisavowStatus | null;
  },
>(rows: readonly T[]): T[] {
  return rows.filter(
    (row) =>
      isExportableDisavowStatus(row.status) &&
      !isWhitelistedDisavowStatus(row.status) &&
      row.classification !== "non_toxic",
  );
}

export function ipv4Subnet(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  return match ? `${match[1]}.0/24` : null;
}

export function normalizeLanguageTag(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const primary = trimmed.split(/[-_]/)[0] ?? trimmed;
  if (primary.length === 3 && primary.startsWith("en")) return "en";
  return primary.slice(0, 3);
}

export function registrableDomain(
  host: string | null | undefined,
): string | null {
  if (!host) return null;
  const parsed = parseTld(host);
  return parsed.domain?.toLowerCase() ?? null;
}

export function scoreBacklinkToxicity(
  input: BacklinkToxicitySignals,
): ToxicityScore {
  const markers = collectBacklinkMarkers(input);
  return finalizeScore(markers);
}

export function scoreDomainToxicity(
  input: DomainToxicitySignals,
): ToxicityScore {
  const markers = [...(input.backlinkMarkers ?? [])];
  if (input.sample) {
    mergeMarkers(markers, collectBacklinkMarkers(input.sample));
  } else {
    mergeMarkers(
      markers,
      collectBacklinkMarkers({
        domainFrom: input.domain,
        domainFromRank: input.rank,
        spamScore: input.spamScore,
      }),
    );
  }

  if (input.backlinkCount >= HIGH_LINKS_PER_DOMAIN) {
    mergeMarkers(markers, [
      marker(
        "high_links_per_domain",
        input.backlinkCount >= 50 ? 28 : 12,
        `${input.backlinkCount} links from ${input.domain}`,
      ),
    ]);
  }

  if ((input.subnetDomainCount ?? 0) >= SUBNET_CLUSTER_MIN_DOMAINS) {
    mergeMarkers(markers, [
      marker(
        "subnet_cluster",
        20,
        `${input.subnetDomainCount} referring domains share a /24`,
      ),
    ]);
  }

  if ((input.recentLinkCount ?? 0) >= VELOCITY_SPIKE_MIN_LINKS) {
    mergeMarkers(markers, [
      marker(
        "velocity_spike",
        16,
        `${input.recentLinkCount} links first seen in 14 days`,
      ),
    ]);
  }

  const result = finalizeScore(markers);
  if (input.maxBacklinkScore != null) {
    return finalizeScore(
      markers,
      Math.max(result.score, input.maxBacklinkScore),
    );
  }
  return result;
}

export function scoreProfileToxicity(input: {
  domainScores: readonly number[];
  toxicDomainCount: number;
  potentiallyToxicDomainCount: number;
  domainCount: number;
}): { score: number; verdict: ToxicityVerdict } {
  const domainCount = Math.max(0, input.domainCount);
  const toxicPercent =
    domainCount === 0 ? 0 : (input.toxicDomainCount / domainCount) * 100;
  const potentiallyPercent =
    domainCount === 0
      ? 0
      : (input.potentiallyToxicDomainCount / domainCount) * 100;
  const average =
    input.domainScores.length === 0
      ? 0
      : Math.round(
          input.domainScores.reduce((sum, score) => sum + score, 0) /
            input.domainScores.length,
        );

  let verdict: ToxicityVerdict = "low";
  if (
    toxicPercent >= HIGH_PROFILE_TOXIC_PERCENT ||
    input.toxicDomainCount >= 20
  ) {
    verdict = "high";
  } else if (
    toxicPercent >= MEDIUM_PROFILE_TOXIC_PERCENT ||
    potentiallyPercent >= 15
  ) {
    verdict = "medium";
  }

  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(Math.max(average, toxicPercent * 2, potentiallyPercent)),
    ),
  );
  return { score, verdict };
}

function collectBacklinkMarkers(input: BacklinkToxicitySignals): ToxicMarker[] {
  const markers: ToxicMarker[] = [];
  const host = normalizeHost(input.domainFrom);
  const registrable = registrableDomain(host);
  const tld = (input.tldFrom ?? host?.split(".").pop() ?? "")
    .toLowerCase()
    .replace(/^\./, "");

  if (registrable && FREE_SUBDOMAIN_REGISTRABLE.has(registrable)) {
    markers.push(marker("free_subdomain", 60, `Hosted on ${registrable}`));
  }

  if (tld && SPAM_TLDS.has(tld)) {
    markers.push(marker("spam_tld", 18, `TLD .${tld}`));
  }

  const spam = input.spamScore ?? null;
  if (spam != null && spam >= 30) {
    markers.push(
      marker(
        "provider_spam_score",
        spam >= 60 ? 25 : 12,
        `Provider spam score ${Math.round(spam)}`,
      ),
    );
  }

  const rank = input.domainFromRank ?? null;
  if (rank != null && rank < LOW_AUTHORITY_RANK) {
    markers.push(
      marker(
        "low_authority",
        rank < 8 ? 15 : 8,
        `Referring-domain rank ${Math.round(rank)}`,
      ),
    );
  }

  const location = (input.semanticLocation ?? "").trim().toLowerCase();
  if (
    SITEWIDE_LOCATIONS.has(location) ||
    (input.linksCount ?? 0) >= SITEWIDE_LINKS_COUNT
  ) {
    markers.push(
      marker(
        "sitewide_footer",
        12,
        location
          ? `semantic_location=${location}`
          : `${input.linksCount} links on the source page`,
      ),
    );
  }

  const anchor = (input.anchor ?? "").trim();
  if (anchor) {
    const lowered = anchor.toLowerCase();
    if (containsTerm(lowered, ADULT_TERMS)) {
      markers.push(marker("adult_anchor", 25, `Anchor: ${truncate(anchor)}`));
    }
    if (containsTerm(lowered, PHARMA_TERMS)) {
      markers.push(marker("pharma_anchor", 25, `Anchor: ${truncate(anchor)}`));
    }
    if (containsTerm(lowered, GAMBLING_TERMS)) {
      markers.push(
        marker("gambling_anchor", 25, `Anchor: ${truncate(anchor)}`),
      );
    }
    if (
      classifyAnchorText(anchor, input.targetHost ?? "") === "commercial" &&
      containsTerm(lowered, COMMERCIAL_EXACT_TERMS)
    ) {
      markers.push(
        marker(
          "exact_match_commercial_anchor",
          15,
          `Anchor: ${truncate(anchor)}`,
        ),
      );
    }
  }

  const pageLanguage = normalizeLanguageTag(input.pageLanguage);
  const targetLanguage = normalizeLanguageTag(input.targetLanguage);
  if (
    pageLanguage &&
    targetLanguage &&
    pageLanguage !== targetLanguage &&
    !pageLanguage.startsWith(targetLanguage) &&
    !targetLanguage.startsWith(pageLanguage)
  ) {
    markers.push(
      marker(
        "language_mismatch",
        10,
        `page=${pageLanguage}, target=${targetLanguage}`,
      ),
    );
  }

  return markers;
}

function finalizeScore(markers: ToxicMarker[], floor?: number): ToxicityScore {
  const unique = dedupeMarkers(markers);
  const raw = unique.reduce((sum, item) => sum + item.points, 0);
  const score = Math.max(
    0,
    Math.min(100, Math.round(Math.max(raw, floor ?? 0))),
  );
  return {
    score,
    classification: classifyToxicityScore(score),
    verdict: verdictFromScore(score),
    markers: unique.toSorted(
      (a, b) => b.points - a.points || a.code.localeCompare(b.code),
    ),
  };
}

function mergeMarkers(into: ToxicMarker[], extra: ToxicMarker[]) {
  into.push(...extra);
}

function dedupeMarkers(markers: ToxicMarker[]): ToxicMarker[] {
  const byCode = new Map<ToxicMarkerCode, ToxicMarker>();
  for (const item of markers) {
    const existing = byCode.get(item.code);
    if (!existing || item.points > existing.points) {
      byCode.set(item.code, item);
    }
  }
  return [...byCode.values()];
}

function marker(
  code: ToxicMarkerCode,
  points: number,
  detail: string,
): ToxicMarker {
  return { code, points, detail };
}

function containsTerm(haystack: string, terms: readonly string[]) {
  return terms.some((term) => {
    const pattern = new RegExp(
      `(^|[^a-z0-9])${term.replaceAll(" ", "[\\s-]+")}([^a-z0-9]|$)`,
      "i",
    );
    return pattern.test(haystack);
  });
}

function normalizeHost(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

function truncate(value: string) {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}
