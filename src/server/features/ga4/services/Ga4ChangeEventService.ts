import { ChangeEventService } from "@/server/features/change-events/services/ChangeEventService";
import type { Ga4ReportMetadata } from "./Ga4ReportNormalization";

const MAX_GA4_CHANGE_EVENTS = 4;
const MIN_PREVIOUS_SESSIONS = 20;
const MIN_PREVIOUS_KEY_EVENTS = 5;
const SESSIONS_PERCENT_THRESHOLD = 0.25;
const KEY_EVENTS_PERCENT_THRESHOLD = 0.3;
const RATE_ABSOLUTE_THRESHOLD = 0.05;

const GA4_DASHBOARD_CHANGE_METRICS = [
  "sessions",
  "keyEvents",
  "sessionKeyEventRate",
  "engagementRate",
] as const;

type Ga4DashboardChangeMetric = (typeof GA4_DASHBOARD_CHANGE_METRICS)[number];
type Ga4DashboardMetricValues = Record<Ga4DashboardChangeMetric, number | null>;

type DateRangePeriod = {
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
};

type Ga4DashboardChangeEvent = {
  eventType: string;
  severity: "opportunity" | "warning";
  title: string;
  summary: string;
  metricKey: Ga4DashboardChangeMetric;
  previousNumericValue: number;
  currentNumericValue: number;
  unit: string;
  dedupeKey: string;
};

const METRIC_COPY: Record<
  Ga4DashboardChangeMetric,
  { noun: string; unit: string; eventKey: string }
> = {
  sessions: { noun: "Sessions", unit: "sessions", eventKey: "sessions" },
  keyEvents: { noun: "Key events", unit: "key events", eventKey: "key_events" },
  sessionKeyEventRate: {
    noun: "Session key-event rate",
    unit: "rate",
    eventKey: "session_key_event_rate",
  },
  engagementRate: {
    noun: "Engagement rate",
    unit: "rate",
    eventKey: "engagement_rate",
  },
};

function isFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function reportIsLimited(metadata: Ga4ReportMetadata): boolean {
  return (
    metadata.dataLossFromOtherRow ||
    metadata.subjectToThresholding ||
    metadata.sampling.length > 0
  );
}

function metricIsRestricted(
  metadata: Ga4ReportMetadata,
  metricKey: Ga4DashboardChangeMetric,
): boolean {
  return metadata.restrictedMetrics.some(
    (restriction) => restriction.metricName === metricKey,
  );
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPercentChange(ratio: number): string {
  const pct = Math.abs(ratio * 100);
  const text =
    Math.abs(pct - Math.round(pct)) < 0.05
      ? String(Math.round(pct))
      : pct.toFixed(1);
  return `${text}%`;
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRange(startDate: string, endDate: string): string {
  return `${startDate} to ${endDate}`;
}

function usableValues(
  current: Ga4DashboardMetricValues,
  previous: Ga4DashboardMetricValues,
  currentMetadata: Ga4ReportMetadata,
  previousMetadata: Ga4ReportMetadata,
  metricKey: Ga4DashboardChangeMetric,
): { current: number; previous: number } | null {
  if (
    metricIsRestricted(currentMetadata, metricKey) ||
    metricIsRestricted(previousMetadata, metricKey)
  ) {
    return null;
  }
  const currentValue = current[metricKey];
  const previousValue = previous[metricKey];
  if (!isFiniteNumber(currentValue) || !isFiniteNumber(previousValue)) {
    return null;
  }
  return { current: currentValue, previous: previousValue };
}

function buildEvent(input: {
  metricKey: Ga4DashboardChangeMetric;
  current: number;
  previous: number;
  period: DateRangePeriod;
  isRate: boolean;
}): Ga4DashboardChangeEvent {
  const gained = input.current > input.previous;
  const copy = METRIC_COPY[input.metricKey];
  const ratio = percentChange(input.current, input.previous);
  const magnitude = input.isRate
    ? `${(Math.abs(input.current - input.previous) * 100).toFixed(1)} percentage points`
    : formatPercentChange(ratio ?? 0);
  const values = input.isRate
    ? `${formatRate(input.previous)} → ${formatRate(input.current)}`
    : `${formatCount(input.previous)} → ${formatCount(input.current)}`;
  return {
    eventType: `ga4.${copy.eventKey}.${gained ? "increase" : "decline"}`,
    severity: gained ? "opportunity" : "warning",
    title: `${copy.noun} ${gained ? "rose" : "fell"} ${magnitude}`,
    summary: `${copy.noun} moved from ${values} versus ${formatRange(input.period.previousStartDate, input.period.previousEndDate)} compared with ${formatRange(input.period.startDate, input.period.endDate)}.`,
    metricKey: input.metricKey,
    previousNumericValue: input.previous,
    currentNumericValue: input.current,
    unit: copy.unit,
    dedupeKey: `ga4:${input.period.startDate}:${input.period.endDate}:${input.metricKey}`,
  };
}

export function analyzeGa4DashboardChanges(input: {
  current: Ga4DashboardMetricValues;
  previous: Ga4DashboardMetricValues;
  currentMetadata: Ga4ReportMetadata;
  previousMetadata: Ga4ReportMetadata;
  period: DateRangePeriod;
}): Ga4DashboardChangeEvent[] {
  if (
    reportIsLimited(input.currentMetadata) ||
    reportIsLimited(input.previousMetadata)
  ) {
    return [];
  }

  const valuesFor = (metricKey: Ga4DashboardChangeMetric) =>
    usableValues(
      input.current,
      input.previous,
      input.currentMetadata,
      input.previousMetadata,
      metricKey,
    );

  const events: Ga4DashboardChangeEvent[] = [];
  const sessions = valuesFor("sessions");
  const sessionRatio = sessions
    ? percentChange(sessions.current, sessions.previous)
    : null;
  if (
    sessions &&
    sessions.previous >= MIN_PREVIOUS_SESSIONS &&
    sessionRatio !== null &&
    Math.abs(sessionRatio) >= SESSIONS_PERCENT_THRESHOLD
  ) {
    events.push(
      buildEvent({
        metricKey: "sessions",
        ...sessions,
        period: input.period,
        isRate: false,
      }),
    );
  }

  const keyEvents = valuesFor("keyEvents");
  const keyEventRatio = keyEvents
    ? percentChange(keyEvents.current, keyEvents.previous)
    : null;
  if (
    keyEvents &&
    keyEvents.previous >= MIN_PREVIOUS_KEY_EVENTS &&
    keyEventRatio !== null &&
    Math.abs(keyEventRatio) >= KEY_EVENTS_PERCENT_THRESHOLD
  ) {
    events.push(
      buildEvent({
        metricKey: "keyEvents",
        ...keyEvents,
        period: input.period,
        isRate: false,
      }),
    );
  }

  const enoughPriorSessions =
    sessions !== null && sessions.previous >= MIN_PREVIOUS_SESSIONS;
  for (const metricKey of ["sessionKeyEventRate", "engagementRate"] as const) {
    const rate = valuesFor(metricKey);
    if (
      !enoughPriorSessions ||
      !rate ||
      Math.abs(rate.current - rate.previous) < RATE_ABSOLUTE_THRESHOLD
    ) {
      continue;
    }
    events.push(
      buildEvent({
        metricKey,
        ...rate,
        period: input.period,
        isRate: true,
      }),
    );
  }

  return events.slice(0, MAX_GA4_CHANGE_EVENTS);
}

async function recordDashboardChanges(input: {
  projectId: string;
  propertyId: string;
  period: DateRangePeriod;
  current: Ga4DashboardMetricValues;
  previous: Ga4DashboardMetricValues;
  currentMetadata: Ga4ReportMetadata;
  previousMetadata: Ga4ReportMetadata;
}) {
  try {
    const changes = analyzeGa4DashboardChanges(input);
    const occurredAt = `${input.period.endDate}T00:00:00.000Z`;
    await Promise.all(
      changes.map((change) =>
        ChangeEventService.record({
          projectId: input.projectId,
          source: "ga4",
          eventType: change.eventType,
          severity: change.severity,
          title: change.title,
          summary: change.summary,
          entityType: "ga4_property",
          entityId: input.propertyId,
          dedupeKey: change.dedupeKey,
          metricKey: change.metricKey,
          previousNumericValue: change.previousNumericValue,
          currentNumericValue: change.currentNumericValue,
          unit: change.unit,
          occurredAt,
        }),
      ),
    );
    return { recorded: changes.length };
  } catch (error) {
    // Dashboard metrics stay authoritative. A secondary alert write must not
    // turn a successful GA4 summary into an error.
    console.error(
      `Project ${input.projectId}: failed to record GA4 change events`,
      error,
    );
    return { recorded: 0 };
  }
}

export const Ga4ChangeEventService = { recordDashboardChanges } as const;
