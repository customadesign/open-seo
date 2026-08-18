import { ChangeEventService } from "@/server/features/change-events/services/ChangeEventService";
import type { BacklinkSnapshotRepository } from "../repositories/BacklinkSnapshotRepository";

type BacklinkSnapshot = NonNullable<
  Awaited<ReturnType<typeof BacklinkSnapshotRepository.getLatestForProject>>
>;

function isMaterialChange(previous: number, current: number) {
  const threshold = Math.max(2, Math.ceil(previous * 0.05));
  return Math.abs(current - previous) >= threshold;
}

export function analyzeBacklinkSnapshotChange(
  previous: BacklinkSnapshot | null,
  current: BacklinkSnapshot,
) {
  if (
    !previous ||
    previous.domain !== current.domain ||
    previous.referringDomains === null ||
    current.referringDomains === null ||
    !isMaterialChange(previous.referringDomains, current.referringDomains)
  ) {
    return null;
  }
  const difference = current.referringDomains - previous.referringDomains;
  return {
    direction: difference > 0 ? ("gained" as const) : ("lost" as const),
    difference: Math.abs(difference),
    previousReferringDomains: previous.referringDomains,
    currentReferringDomains: current.referringDomains,
    backlinkDifference:
      previous.backlinks !== null && current.backlinks !== null
        ? current.backlinks - previous.backlinks
        : null,
  };
}

async function recordChange(
  previous: BacklinkSnapshot | null,
  current: BacklinkSnapshot,
) {
  const change = analyzeBacklinkSnapshotChange(previous, current);
  if (!change) return { recorded: 0 };
  const gained = change.direction === "gained";
  const backlinkDetail =
    change.backlinkDifference === null
      ? ""
      : ` Total backlinks changed by ${change.backlinkDifference > 0 ? "+" : ""}${change.backlinkDifference.toLocaleString()}.`;
  await ChangeEventService.record({
    projectId: current.projectId,
    source: "backlinks",
    eventType: gained ? "backlinks.gained" : "backlinks.lost",
    severity: gained ? "opportunity" : "warning",
    title: `${change.difference} referring ${change.difference === 1 ? "domain" : "domains"} ${gained ? "gained" : "lost"}`,
    summary: `${current.domain} moved from ${change.previousReferringDomains.toLocaleString()} to ${change.currentReferringDomains.toLocaleString()} referring domains.${backlinkDetail}`,
    entityType: "backlink_snapshot",
    entityId: String(current.id),
    sourceRunId: String(current.id),
    dedupeKey: `backlinks:${current.id}:${change.direction}`,
    metricKey: "referring_domains",
    previousNumericValue: change.previousReferringDomains,
    currentNumericValue: change.currentReferringDomains,
    unit: "domains",
    occurredAt: current.capturedAt,
  });
  return { recorded: 1 };
}

export const BacklinkChangeEventService = { recordChange } as const;
