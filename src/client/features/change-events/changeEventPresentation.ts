import type {
  ChangeEventSeverity,
  ChangeEventSource,
} from "@/types/schemas/change-events";

export const changeEventSourceLabels: Record<ChangeEventSource, string> = {
  audit: "Site Audit",
  rank_tracking: "Rank Tracking",
  backlinks: "Backlinks",
  gsc: "Search Console",
  ga4: "Google Analytics",
  local_seo: "Local SEO",
  reports: "Reports",
  system: "OpenSEO",
};

export function changeEventSeverityClass(severity: ChangeEventSeverity) {
  if (severity === "critical") return "badge-error";
  if (severity === "warning") return "badge-warning";
  if (severity === "opportunity") return "badge-success";
  return "badge-ghost";
}

export function formatChangeEventDate(value: string) {
  const parsed = new Date(
    value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
  );
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

const numberFormat = new Intl.NumberFormat("en-US");

/** `unit` names both a kind and a noun. `rate` and `ctr` are 0..1 fractions;
 * `position` is an average SERP position; everything else is a plain count. */
type ChangeEventUnitKind = "ratio" | "position" | "count";

function unitKind(unit: string | null): ChangeEventUnitKind {
  if (unit === "rate" || unit === "ctr") return "ratio";
  if (unit === "position") return "position";
  return "count";
}

export function formatChangeEventValue(value: number, unit: string | null) {
  const kind = unitKind(unit);
  if (kind === "ratio") return `${(value * 100).toFixed(1)}%`;
  if (kind === "position") return value.toFixed(1);
  return numberFormat.format(value);
}

/** Magnitude and which way the number moved — never whether that is good news.
 * Valence lives in `severity`, which the detector already resolved: an
 * `opportunity` position event moves *down*, and `backlinks.lost` moves down
 * too. Re-deriving good/bad from the sign here would get both backwards. */
type ChangeEventDelta = {
  direction: "up" | "down" | "flat";
  label: string;
};

export function changeEventDelta(event: {
  previousNumericValue: number | null;
  currentNumericValue: number | null;
  unit: string | null;
}): ChangeEventDelta | null {
  const { previousNumericValue: previous, currentNumericValue: current } =
    event;
  if (previous === null || current === null) return null;
  const difference = current - previous;
  const direction =
    difference > 0 ? "up" : difference < 0 ? "down" : ("flat" as const);
  const magnitude = Math.abs(difference);
  const kind = unitKind(event.unit);

  if (kind === "ratio") {
    return { direction, label: `${(magnitude * 100).toFixed(1)} points` };
  }
  if (kind === "position") {
    const places = magnitude === 1 ? "place" : "places";
    return { direction, label: `${magnitude.toFixed(1)} ${places}` };
  }
  // A percent change off a zero baseline is Infinity. `audit.improvement` always
  // hits this (it records previous = 0), and rank tracking has no zero guard
  // either, so fall back to the absolute count rather than printing "+∞%".
  if (previous === 0 || event.unit === "keyword-device rankings") {
    return { direction, label: numberFormat.format(magnitude) };
  }
  const percent = (magnitude / Math.abs(previous)) * 100;
  const rounded =
    Math.abs(percent - Math.round(percent)) < 0.05
      ? String(Math.round(percent))
      : percent.toFixed(1);
  return { direction, label: `${rounded}%` };
}

/** Detectors name metrics for their own storage, not for reading. Two of these
 * also measure something other than what the event title counts: an audit event
 * is titled by *new* issues but records the *total*, and a rank tracking event
 * is titled by keywords that moved but records how many sit in the top 10. */
const changeEventMetricLabels: Record<string, string> = {
  sessions: "Sessions",
  keyEvents: "Key events",
  sessionKeyEventRate: "Session key-event rate",
  engagementRate: "Engagement rate",
  clicks: "Clicks",
  impressions: "Impressions",
  ctr: "Click-through rate",
  position: "Average position",
  issue_count: "Total issues",
  resolved_issue_count: "Issues resolved",
  top_10_rankings: "Keywords in the top 10",
  referring_domains: "Referring domains",
};

export function changeEventMetricLabel(metricKey: string) {
  return changeEventMetricLabels[metricKey] ?? metricKey;
}

// Why a change made the feed at all. These restate the detection thresholds in
// the producer services, so they have to be re-read when a threshold is tuned:
// GA4 `Ga4ChangeEventService.ts`, Search Console `GscChangeEventService.ts`,
// backlinks `BacklinkChangeEventService.ts`, rank tracking
// `RankChangeEventService.ts`, site audit `AuditComparisonService.ts`.
const GA4_SESSIONS =
  "Sessions are reported when they move at least 25% and the previous period had at least 20 sessions. Smaller swings, and swings off a very small base, are usually noise rather than a trend.";
const GA4_KEY_EVENTS =
  "Key events are reported when they move at least 30% and the previous period had at least 5 of them. Conversion counts are small enough that a lower bar would fire on ordinary week-to-week variation.";
const GA4_RATE =
  "Rates are reported when they move at least 5 percentage points and the previous period had at least 20 sessions. A rate off a handful of sessions swings wildly on its own, so the session floor applies here too.";
const GSC_CLICKS =
  "Clicks are reported when they move by at least 10 clicks and at least 20%. Both bars have to clear, so a large percentage on tiny numbers stays out of the feed.";
const GSC_IMPRESSIONS =
  "Impressions are reported when they move by at least 100 impressions and at least 25%. Both bars have to clear, so a large percentage on tiny numbers stays out of the feed.";
const GSC_CTR =
  "Click-through rate is reported when it moves at least 2 percentage points, and only when both periods had at least 100 impressions to measure against.";
const GSC_POSITION =
  "Average position is reported when it moves at least 2 places, and only when both periods had at least 100 impressions. A lower number is a better position, so an improvement here is a fall.";
const AUDIT_ISSUES =
  "Site audit changes are compared against the previous completed crawl of the same start URL. There is no size threshold — a single new or resolved issue is worth telling you about.";
const RANK_MOVEMENT =
  "Rank changes are compared against the previous full check, across the keyword and device pairs present in both runs. A keyword counts as moved when it shifts at least 3 places or crosses in or out of the top 10.";
const BACKLINKS =
  "Referring domains are reported when they move by 5% or 2 domains, whichever is larger, against the previous stored snapshot for this domain.";

const changeEventExplanations: Record<string, string> = {
  "ga4.sessions.increase": GA4_SESSIONS,
  "ga4.sessions.decline": GA4_SESSIONS,
  "ga4.key_events.increase": GA4_KEY_EVENTS,
  "ga4.key_events.decline": GA4_KEY_EVENTS,
  "ga4.session_key_event_rate.increase": GA4_RATE,
  "ga4.session_key_event_rate.decline": GA4_RATE,
  "ga4.engagement_rate.increase": GA4_RATE,
  "ga4.engagement_rate.decline": GA4_RATE,
  "gsc.clicks.gain": GSC_CLICKS,
  "gsc.clicks.decline": GSC_CLICKS,
  "gsc.impressions.gain": GSC_IMPRESSIONS,
  "gsc.impressions.decline": GSC_IMPRESSIONS,
  "gsc.ctr.gain": GSC_CTR,
  "gsc.ctr.decline": GSC_CTR,
  "gsc.position.gain": GSC_POSITION,
  "gsc.position.decline": GSC_POSITION,
  "audit.regression": AUDIT_ISSUES,
  "audit.improvement": AUDIT_ISSUES,
  "rank_tracking.improvement": RANK_MOVEMENT,
  "rank_tracking.decline": RANK_MOVEMENT,
  "rank_tracking.failed": "A scheduled rank check did not finish.",
  "backlinks.gained": BACKLINKS,
  "backlinks.lost": BACKLINKS,
  "reports.failed": "A scheduled report run did not finish.",
  "reports.recovered":
    "A later run of a report that had been failing succeeded.",
};

/** Null means say nothing. `eventType` is an unconstrained text column, so an
 * unknown value is always reachable — including whenever a detector ships ahead
 * of this client. Inventing an explanation for one would be worse than omitting
 * the section. */
export function explainChangeEvent(event: { eventType: string }) {
  return changeEventExplanations[event.eventType] ?? null;
}

/** What the current period is being compared against, for detectors that have no
 * date window to show. Null for sources with no detector today. */
const changeEventBaselines: Partial<Record<ChangeEventSource, string>> = {
  ga4: "The equal-length period immediately before",
  gsc: "The equal-length period immediately before",
  audit: "The previous completed crawl of the same start URL",
  rank_tracking: "The previous full rank check",
  backlinks: "The previous backlink snapshot",
};

export function changeEventBaseline(source: ChangeEventSource) {
  return changeEventBaselines[source] ?? null;
}
