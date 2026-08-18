import type {
  DashboardMetric,
  DashboardMetricKey,
} from "@/server/features/dashboard/services/dashboardMetricTypes";
import { parseDbTimestampMs } from "@/shared/db-timestamps";

/**
 * Cards the metrics refresh path can fill in. Backlinks are absent on purpose:
 * the Backlink pulse card below owns that snapshot's refresh, so triggering this
 * one for a stale backlink count would only duplicate spend.
 */
const REFRESHABLE_KEYS = new Set<DashboardMetricKey>([
  "ai_visibility",
  "mentions",
  "organic_traffic",
  "organic_keywords",
]);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Keep a queued AI baseline visible without polling forever. */
const AI_BASELINE_POLL_INTERVAL_MS = 1_000;
const AI_BASELINE_MAX_POLL_ATTEMPTS = 15;

const READ_ONLY_COLLECTION_NOTE =
  "Waiting for a workspace manager to start collection.";

/**
 * True when a snapshot-backed card has nothing yet or its snapshot is over a day
 * old.
 *
 * Deliberately ignores `unavailable` and `setup`: a plan block, a credit block or
 * a missing domain would otherwise put every page view into a refresh call
 * against a gate that will keep refusing.
 */
export function needsMetricRefresh(metrics: DashboardMetric[]): boolean {
  return metrics.some((metric) => {
    if (!REFRESHABLE_KEYS.has(metric.key)) return false;
    if (metric.status === "collecting") return true;
    if (metric.status !== "ready" || metric.capturedAt === null) return false;
    const capturedMs = parseDbTimestampMs(metric.capturedAt);
    return capturedMs === null || Date.now() - capturedMs >= ONE_DAY_MS;
  });
}

/**
 * Client-role viewers can read the cards but cannot invoke the refresh server
 * function. Replace action-oriented collection copy for that viewer instead
 * of telling them that data is being collected when nobody they can trigger is
 * doing so.
 */
export function metricForViewer(
  metric: DashboardMetric,
  canUseProjectTools: boolean,
): DashboardMetric {
  if (canUseProjectTools || metric.status !== "collecting") return metric;
  return { ...metric, note: READ_ONLY_COLLECTION_NOTE };
}

function aiBaselineStillCollecting(metrics: DashboardMetric[]): boolean {
  return metrics.some(
    (metric) =>
      (metric.key === "ai_visibility" || metric.key === "mentions") &&
      metric.status === "collecting",
  );
}

/**
 * Refetch a queued AI baseline a bounded number of times. The returned cleanup
 * function is safe to call while a refetch is in flight: its completion may be
 * ignored, but it cannot schedule another timer after cancellation.
 */
export function pollQueuedAiBaseline(input: {
  refetch: () => Promise<DashboardMetric[]>;
  intervalMs?: number;
  maxAttempts?: number;
}): () => void {
  const intervalMs = input.intervalMs ?? AI_BASELINE_POLL_INTERVAL_MS;
  const maxAttempts = input.maxAttempts ?? AI_BASELINE_MAX_POLL_ATTEMPTS;
  let cancelled = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const poll = async () => {
    if (cancelled || attempts >= maxAttempts) return;
    attempts += 1;

    let metrics: DashboardMetric[];
    try {
      metrics = await input.refetch();
    } catch {
      // A transient read error must not create an unbounded retry loop. It can
      // try again within the same fixed attempt budget.
      if (!cancelled && attempts < maxAttempts) {
        timer = setTimeout(() => void poll(), intervalMs);
      }
      return;
    }

    if (
      cancelled ||
      !aiBaselineStillCollecting(metrics) ||
      attempts >= maxAttempts
    ) {
      return;
    }
    timer = setTimeout(() => void poll(), intervalMs);
  };

  void poll();
  return () => {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}
