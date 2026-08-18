import { ChangeEventService } from "@/server/features/change-events/services/ChangeEventService";
import type { SearchPerformanceDateRange } from "@/types/schemas/search-performance";

export type GscSearchTotals = {
  clicks: number;
  impressions: number;
  /** 0..1 (clicks / impressions). */
  ctr: number;
  position: number;
};

type GscMetricKey = "clicks" | "impressions" | "ctr" | "position";
type GscChangeDirection = "gain" | "decline";

type GscMetricChange = {
  metricKey: GscMetricKey;
  direction: GscChangeDirection;
  previousValue: number;
  currentValue: number;
};

const RANGE_LABELS: Record<SearchPerformanceDateRange, string> = {
  last_7_days: "Last 7 days",
  last_28_days: "Last 28 days",
  last_3_months: "Last 3 months",
};

const DEVICE_LABELS: Record<string, string> = {
  DESKTOP: "Desktop",
  MOBILE: "Mobile",
  TABLET: "Tablet",
};

const CLICKS_ABS_THRESHOLD = 10;
const CLICKS_REL_THRESHOLD = 0.2;
const IMPRESSIONS_ABS_THRESHOLD = 100;
const IMPRESSIONS_REL_THRESHOLD = 0.25;
const CTR_POINT_THRESHOLD = 0.02;
const POSITION_THRESHOLD = 2;
const IMPRESSION_BASELINE = 100;

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function absoluteDelta(current: number, previous: number): number | null {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous)) return null;
  const delta = current - previous;
  return Number.isFinite(delta) ? delta : null;
}

function relativeDelta(current: number, previous: number): number | null {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous) || previous <= 0) {
    return null;
  }
  const relative = (current - previous) / previous;
  return Number.isFinite(relative) ? relative : null;
}

function volumeChange(
  metricKey: "clicks" | "impressions",
  current: number,
  previous: number,
  absThreshold: number,
  relThreshold: number,
): GscMetricChange | null {
  const absolute = absoluteDelta(current, previous);
  const relative = relativeDelta(current, previous);
  if (
    absolute === null ||
    relative === null ||
    Math.abs(absolute) < absThreshold ||
    Math.abs(relative) < relThreshold
  ) {
    return null;
  }
  return {
    metricKey,
    direction: absolute > 0 ? "gain" : "decline",
    previousValue: previous,
    currentValue: current,
  };
}

function rateChange(input: {
  metricKey: "ctr" | "position";
  current: number;
  previous: number;
  currentImpressions: number;
  previousImpressions: number;
  absThreshold: number;
  invertDirection: boolean;
}): GscMetricChange | null {
  if (
    !isFiniteNumber(input.currentImpressions) ||
    !isFiniteNumber(input.previousImpressions) ||
    input.currentImpressions < IMPRESSION_BASELINE ||
    input.previousImpressions < IMPRESSION_BASELINE
  ) {
    return null;
  }
  const absolute = absoluteDelta(input.current, input.previous);
  if (absolute === null || Math.abs(absolute) < input.absThreshold) {
    return null;
  }
  const improved = input.invertDirection ? absolute < 0 : absolute > 0;
  return {
    metricKey: input.metricKey,
    direction: improved ? "gain" : "decline",
    previousValue: input.previous,
    currentValue: input.current,
  };
}

/** Compare current vs equal-length previous-period totals already fetched
 *  by getSearchPerformanceReport. Emits nothing when a baseline is too small
 *  or a metric is non-finite. */
export function analyzeGscSearchPerformanceChange(
  current: GscSearchTotals,
  previous: GscSearchTotals,
): GscMetricChange[] {
  return [
    volumeChange(
      "clicks",
      current.clicks,
      previous.clicks,
      CLICKS_ABS_THRESHOLD,
      CLICKS_REL_THRESHOLD,
    ),
    volumeChange(
      "impressions",
      current.impressions,
      previous.impressions,
      IMPRESSIONS_ABS_THRESHOLD,
      IMPRESSIONS_REL_THRESHOLD,
    ),
    rateChange({
      metricKey: "ctr",
      current: current.ctr,
      previous: previous.ctr,
      currentImpressions: current.impressions,
      previousImpressions: previous.impressions,
      absThreshold: CTR_POINT_THRESHOLD,
      invertDirection: false,
    }),
    rateChange({
      metricKey: "position",
      current: current.position,
      previous: previous.position,
      currentImpressions: current.impressions,
      previousImpressions: previous.impressions,
      absThreshold: POSITION_THRESHOLD,
      invertDirection: true,
    }),
  ].filter((change): change is GscMetricChange => change !== null);
}

type GscChangeEventContext = {
  projectId: string;
  dateRange: SearchPerformanceDateRange;
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
  device?: string;
  country?: string;
  current: GscSearchTotals;
  previous: GscSearchTotals;
};

function filterToken(value: string | undefined): string {
  return value && value.length > 0 ? value : "all";
}

function filterContext(device?: string, country?: string): string {
  const parts: string[] = [];
  if (device) parts.push(DEVICE_LABELS[device] ?? device);
  if (country) parts.push(country.toUpperCase());
  return parts.length === 0 ? "" : ` Filtered to ${parts.join(", ")}.`;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatPercentPoints(value: number): string {
  return (Math.abs(value) * 100).toFixed(1);
}

function formatRelativePercent(previous: number, current: number): string {
  return `${Math.round((Math.abs(current - previous) / previous) * 100)}%`;
}

function formatPosition(value: number): string {
  return value.toFixed(1);
}

function titleFor(change: GscMetricChange): string {
  if (change.metricKey === "clicks") {
    return `Search clicks ${change.direction === "gain" ? "rose" : "dropped"} ${formatRelativePercent(change.previousValue, change.currentValue)}`;
  }
  if (change.metricKey === "impressions") {
    return `Search impressions ${change.direction === "gain" ? "rose" : "dropped"} ${formatRelativePercent(change.previousValue, change.currentValue)}`;
  }
  if (change.metricKey === "ctr") {
    return `Search CTR ${change.direction === "gain" ? "rose" : "dropped"} ${formatPercentPoints(change.currentValue - change.previousValue)} points`;
  }
  return `Average position ${change.direction === "gain" ? "improved" : "worsened"} ${formatPosition(Math.abs(change.currentValue - change.previousValue))}`;
}

function metricSentence(change: GscMetricChange): string {
  if (change.metricKey === "clicks") {
    return `Clicks moved from ${formatCount(change.previousValue)} to ${formatCount(change.currentValue)}.`;
  }
  if (change.metricKey === "impressions") {
    return `Impressions moved from ${formatCount(change.previousValue)} to ${formatCount(change.currentValue)}.`;
  }
  if (change.metricKey === "ctr") {
    return `CTR moved from ${formatPercentPoints(change.previousValue)}% to ${formatPercentPoints(change.currentValue)}%.`;
  }
  return `Average position moved from ${formatPosition(change.previousValue)} to ${formatPosition(change.currentValue)}.`;
}

function unitFor(metricKey: GscMetricKey): string {
  if (metricKey === "ctr") return "ctr";
  if (metricKey === "position") return "position";
  return metricKey;
}

export function buildGscChangeEvents(input: GscChangeEventContext) {
  const changes = analyzeGscSearchPerformanceChange(
    input.current,
    input.previous,
  );
  const rangeLabel = RANGE_LABELS[input.dateRange];
  const filters = filterContext(input.device, input.country);
  const occurredAt = `${input.endDate}T00:00:00.000Z`;
  return changes.map((change) => ({
    projectId: input.projectId,
    source: "gsc" as const,
    eventType: `gsc.${change.metricKey}.${change.direction}`,
    severity:
      change.direction === "gain"
        ? ("opportunity" as const)
        : ("warning" as const),
    title: titleFor(change),
    summary: `${rangeLabel} (${input.startDate} to ${input.endDate}) compared with ${input.prevStartDate} to ${input.prevEndDate}. ${metricSentence(change)}${filters}`,
    entityType: "search_performance",
    entityId: input.projectId,
    sourceRunId: `${input.dateRange}:${input.startDate}:${input.endDate}`,
    dedupeKey: `gsc:${input.dateRange}:${input.startDate}:${input.endDate}:${filterToken(input.device)}:${filterToken(input.country)}:${change.metricKey}`,
    metricKey: change.metricKey,
    previousNumericValue: change.previousValue,
    currentNumericValue: change.currentValue,
    unit: unitFor(change.metricKey),
    occurredAt,
    periodStart: input.startDate,
    periodEnd: input.endDate,
    previousPeriodStart: input.prevStartDate,
    previousPeriodEnd: input.prevEndDate,
  }));
}

async function recordFromReport(input: GscChangeEventContext) {
  try {
    const events = buildGscChangeEvents(input);
    if (events.length === 0) return { recorded: 0 };
    await Promise.all(events.map((event) => ChangeEventService.record(event)));
    return { recorded: events.length };
  } catch (error) {
    // The GSC report already succeeded. Alert persistence must not change that.
    console.error("gsc: failed to record change events", error);
    return { recorded: 0 };
  }
}

export const GscChangeEventService = { recordFromReport } as const;
