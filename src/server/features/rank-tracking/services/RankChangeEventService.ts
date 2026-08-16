import { ChangeEventService } from "@/server/features/change-events/services/ChangeEventService";
import { RankChangeRepository } from "../repositories/RankChangeRepository";
import { RankTrackingRepository } from "../repositories/RankTrackingRepository";

type RankSnapshot = Awaited<
  ReturnType<typeof RankTrackingRepository.getSnapshotsForRun>
>[number];

type RankMovement = {
  trackingKeywordId: string;
  keyword: string;
  device: "desktop" | "mobile";
  previousPosition: number | null;
  currentPosition: number | null;
};

function movementKey(snapshot: RankSnapshot) {
  return `${snapshot.trackingKeywordId}:${snapshot.device}`;
}

function isMaterialImprovement(
  previous: number | null,
  current: number | null,
) {
  if (previous === null) return current !== null;
  if (current === null) return false;
  return previous - current >= 3 || (previous > 10 && current <= 10);
}

function isMaterialDecline(previous: number | null, current: number | null) {
  if (previous === null) return false;
  if (current === null) return true;
  return current - previous >= 3 || (previous <= 10 && current > 10);
}

export function analyzeRankMovement(
  currentSnapshots: RankSnapshot[],
  previousSnapshots: RankSnapshot[],
) {
  const previousByKey = new Map(
    previousSnapshots.map((snapshot) => [movementKey(snapshot), snapshot]),
  );
  const movements: RankMovement[] = [];
  for (const current of currentSnapshots) {
    const previous = previousByKey.get(movementKey(current));
    if (!previous) continue;
    movements.push({
      trackingKeywordId: current.trackingKeywordId,
      keyword: current.keyword,
      device: current.device,
      previousPosition: previous.position,
      currentPosition: current.position,
    });
  }

  const improved = movements.filter((movement) =>
    isMaterialImprovement(movement.previousPosition, movement.currentPosition),
  );
  const declined = movements.filter((movement) =>
    isMaterialDecline(movement.previousPosition, movement.currentPosition),
  );
  const enteredTopTen = movements.filter(
    ({ previousPosition, currentPosition }) =>
      currentPosition !== null &&
      currentPosition <= 10 &&
      (previousPosition === null || previousPosition > 10),
  ).length;
  const leftTopTen = movements.filter(
    ({ previousPosition, currentPosition }) =>
      previousPosition !== null &&
      previousPosition <= 10 &&
      (currentPosition === null || currentPosition > 10),
  ).length;
  const previousTopTen = movements.filter(
    ({ previousPosition }) =>
      previousPosition !== null && previousPosition <= 10,
  ).length;
  const currentTopTen = movements.filter(
    ({ currentPosition }) => currentPosition !== null && currentPosition <= 10,
  ).length;

  return {
    compared: movements.length,
    improved,
    declined,
    enteredTopTen,
    leftTopTen,
    previousTopTen,
    currentTopTen,
  };
}

async function recordChangeEvents(input: {
  runId: string;
  configId: string;
  projectId: string;
}) {
  const run = await RankTrackingRepository.getRunById(input.runId);
  if (!run || run.status !== "completed" || run.isSubsetRun) {
    return { recorded: 0 };
  }
  const previousRun = await RankChangeRepository.getPreviousCompletedFullRun(
    input.configId,
    run.startedAt,
  );
  if (!previousRun) return { recorded: 0 };

  const [currentSnapshots, previousSnapshots] = await Promise.all([
    RankTrackingRepository.getSnapshotsForRun(run.id),
    RankTrackingRepository.getSnapshotsForRun(previousRun.id),
  ]);
  const movement = analyzeRankMovement(currentSnapshots, previousSnapshots);
  const occurredAt = run.completedAt ?? run.startedAt;
  const events: Parameters<typeof ChangeEventService.record>[0][] = [];

  if (movement.declined.length > 0) {
    events.push({
      projectId: input.projectId,
      source: "rank_tracking",
      eventType: "rank_tracking.decline",
      severity: "warning",
      title: `${movement.declined.length} tracked ${movement.declined.length === 1 ? "ranking declined" : "rankings declined"}`,
      summary: `${movement.leftTopTen} left the top 10. Compared ${movement.compared} keyword/device rankings with the previous full check.`,
      entityType: "rank_tracking_config",
      entityId: input.configId,
      sourceRunId: input.runId,
      dedupeKey: `rank:${input.runId}:decline`,
      metricKey: "top_10_rankings",
      previousNumericValue: movement.previousTopTen,
      currentNumericValue: movement.currentTopTen,
      unit: "keyword-device rankings",
      occurredAt,
    });
  }
  if (movement.improved.length > 0) {
    events.push({
      projectId: input.projectId,
      source: "rank_tracking",
      eventType: "rank_tracking.improvement",
      severity: "opportunity",
      title: `${movement.improved.length} tracked ${movement.improved.length === 1 ? "ranking improved" : "rankings improved"}`,
      summary: `${movement.enteredTopTen} entered the top 10. Compared ${movement.compared} keyword/device rankings with the previous full check.`,
      entityType: "rank_tracking_config",
      entityId: input.configId,
      sourceRunId: input.runId,
      dedupeKey: `rank:${input.runId}:improvement`,
      metricKey: "top_10_rankings",
      previousNumericValue: movement.previousTopTen,
      currentNumericValue: movement.currentTopTen,
      unit: "keyword-device rankings",
      occurredAt,
    });
  }

  await Promise.all(events.map((event) => ChangeEventService.record(event)));
  return { recorded: events.length };
}

export const RankChangeEventService = { recordChangeEvents } as const;
