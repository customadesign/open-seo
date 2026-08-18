import {
  absoluteChange,
  NO_DOMAIN_NOTE,
  type DashboardMetric,
  type DashboardMetricSources,
  type DashboardMetricStatus,
  type DashboardMetricTarget,
} from "@/server/features/dashboard/services/dashboardMetricTypes";

// The two AI cards read from the same persisted run stack, so they share one
// status decision: if AI collection is blocked or still warming up, both cards
// must say the same thing rather than one showing a number and the other not.

const AI_SOURCE_LABEL = "AI answers · ChatGPT, Gemini, Google AI Mode";

/** Shared status/note for the two AI metrics — they come from the same runs. */
function aiMetricState(sources: DashboardMetricSources): {
  status: DashboardMetricStatus;
  note: string | null;
  target: DashboardMetricTarget | null;
} {
  const { aiVisibility, hasDomain } = sources;
  if (!hasDomain) {
    return { status: "setup", note: NO_DOMAIN_NOTE, target: "settings" };
  }
  if (aiVisibility.skipReason === "plan_required") {
    return {
      status: "unavailable",
      note: "AI visibility tracking needs a paid plan.",
      target: "billing",
    };
  }
  if (aiVisibility.skipReason === "insufficient_credits") {
    return {
      status: "unavailable",
      note: "Out of credits — top up to resume AI tracking.",
      target: "billing",
    };
  }
  if (aiVisibility.skipReason === "cost_ceiling") {
    return {
      status: "unavailable",
      note: "This AI baseline exceeds its approved credit limit.",
      target: "billing",
    };
  }
  if (!aiVisibility.latest) {
    return {
      status: "collecting",
      note: "Taking your first AI visibility baseline…",
      target: null,
    };
  }
  if (aiVisibility.latest.summary.readableObservations === 0) {
    return {
      status: "unavailable",
      note: "Every AI provider was unavailable on the last run.",
      target: null,
    };
  }
  return { status: "ready", note: null, target: null };
}

export function buildAiVisibilityMetric(
  sources: DashboardMetricSources,
): DashboardMetric {
  const state = aiMetricState(sources);
  const latest = sources.aiVisibility.latest;
  const previous = sources.aiVisibility.previous;
  const value =
    state.status === "ready"
      ? (latest?.summary.visibilityPercent ?? null)
      : null;

  return {
    key: "ai_visibility",
    label: "AI Visibility",
    value,
    unit: "percent",
    // Percentage points: the metric IS a share of answers, so a relative
    // percentage change would be a percentage of a percentage.
    delta:
      value === null
        ? null
        : absoluteChange(value, previous?.summary.visibilityPercent ?? null),
    deltaKind: "percentage_points",
    capturedAt: value === null ? null : (latest?.capturedAt ?? null),
    sourceLabel: AI_SOURCE_LABEL,
    estimated: false,
    status: state.status,
    target: state.target,
    note: state.note,
  };
}

export function buildMentionsMetric(
  sources: DashboardMetricSources,
): DashboardMetric {
  const state = aiMetricState(sources);
  const latest = sources.aiVisibility.latest;
  const previous = sources.aiVisibility.previous;
  const value =
    state.status === "ready" ? (latest?.summary.mentions ?? null) : null;

  return {
    key: "mentions",
    label: "Mentions",
    value,
    unit: "count",
    delta:
      value === null
        ? null
        : absoluteChange(value, previous?.summary.mentions ?? null),
    deltaKind: "absolute",
    capturedAt: value === null ? null : (latest?.capturedAt ?? null),
    sourceLabel: AI_SOURCE_LABEL,
    estimated: false,
    status: state.status,
    target: state.target,
    note: state.note,
  };
}
