import {
  isDisavowCandidate,
  isWhitelistedDisavowStatus,
  type ToxicMarker,
  type ToxicityClassification,
  type ToxicityVerdict,
} from "@/shared/backlink-toxicity";
import type { DisavowStatus } from "@/types/schemas/disavow";

export type ToxicityDomainView = {
  domain: string;
  score: number;
  verdict: ToxicityVerdict;
  classification: ToxicityClassification;
  backlinkCount: number;
  brokenBacklinkCount: number;
  rank: number | null;
  spamScore: number | null;
  isNew: boolean;
  isLost: boolean;
  isBroken: boolean;
  markers: ToxicMarker[];
  status: DisavowStatus | null;
  isWhitelisted: boolean;
  isDisavowCandidate: boolean;
};

export type ToxicityAuditView = {
  id: string;
  target: string;
  scope: "domain" | "page";
  createdAt: string;
  profileScore: number;
  profileVerdict: ToxicityVerdict;
  domainCount: number;
  backlinkCount: number;
  toxicCount: number;
  potentiallyToxicCount: number;
  nonToxicCount: number;
  toxicPercent: number;
  newDomainCount: number;
  lostDomainCount: number;
  brokenDomainCount: number;
  newBacklinkCount: number;
  lostBacklinkCount: number;
  brokenBacklinkCount: number;
  truncated: boolean;
  domains: ToxicityDomainView[];
};

export function countLive(
  live: Array<{
    classification: ToxicityClassification;
    backlinkCount: number;
  }>,
) {
  const toxicCount = live.filter(
    (row) => row.classification === "toxic",
  ).length;
  return {
    domainCount: live.length,
    backlinkCount: live.reduce((sum, row) => sum + row.backlinkCount, 0),
    toxicCount,
    potentiallyToxicCount: live.filter(
      (row) => row.classification === "potentially_toxic",
    ).length,
    nonToxicCount: live.filter((row) => row.classification === "non_toxic")
      .length,
    toxicPercent:
      live.length === 0 ? 0 : Math.round((toxicCount / live.length) * 100),
  };
}

export function sumBacklinkDelta(
  live: Array<{ domain: string; backlinkCount: number }>,
  previousByDomain: Map<string, { backlinkCount: number }>,
  direction: 1 | -1,
) {
  return live.reduce((sum, row) => {
    const prior = previousByDomain.get(row.domain)?.backlinkCount ?? 0;
    const delta =
      direction === 1 ? row.backlinkCount - prior : prior - row.backlinkCount;
    return sum + Math.max(0, delta);
  }, 0);
}

export function toView(
  audit: Omit<ToxicityAuditView, "domains">,
  domains: Array<{
    domain: string;
    score: number;
    verdict: ToxicityVerdict;
    classification: ToxicityClassification;
    backlinkCount: number;
    brokenBacklinkCount: number;
    rank: number | null;
    spamScore: number | null;
    isNew: boolean;
    isLost: boolean;
    isBroken: boolean;
    markersJson: string;
  }>,
  statuses: Map<string, DisavowStatus>,
): ToxicityAuditView {
  return {
    ...audit,
    domains: domains
      .map((row) => {
        const status = statuses.get(row.domain) ?? null;
        return {
          domain: row.domain,
          score: row.score,
          verdict: row.verdict,
          classification: row.classification,
          backlinkCount: row.backlinkCount,
          brokenBacklinkCount: row.brokenBacklinkCount,
          rank: row.rank,
          spamScore: row.spamScore,
          isNew: row.isNew,
          isLost: row.isLost,
          isBroken: row.isBroken,
          markers: parseMarkers(row.markersJson),
          status,
          isWhitelisted: isWhitelistedDisavowStatus(status),
          isDisavowCandidate: isDisavowCandidate({
            classification: row.classification,
            status,
          }),
        } satisfies ToxicityDomainView;
      })
      .toSorted(
        (a, b) => b.score - a.score || a.domain.localeCompare(b.domain),
      ),
  };
}

export function allToRows(
  auditId: string,
  projectId: string,
  createdAt: string,
  rows: Array<{
    domain: string;
    score: number;
    verdict: ToxicityVerdict;
    classification: ToxicityClassification;
    backlinkCount: number;
    brokenBacklinkCount: number;
    rank: number | null;
    spamScore: number | null;
    isNew: boolean;
    isLost: boolean;
    isBroken: boolean;
    markers: ToxicMarker[];
  }>,
) {
  return rows.map((row) => ({
    id: "",
    auditId,
    projectId,
    createdAt,
    ...row,
    markersJson: JSON.stringify(row.markers),
  }));
}

export function parseMarkers(raw: string): ToxicMarker[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isToxicMarker);
  } catch {
    return [];
  }
}

function isToxicMarker(value: unknown): value is ToxicMarker {
  if (!value || typeof value !== "object") return false;
  if (!("code" in value) || !("points" in value) || !("detail" in value)) {
    return false;
  }
  return (
    typeof value.code === "string" &&
    typeof value.points === "number" &&
    typeof value.detail === "string"
  );
}
