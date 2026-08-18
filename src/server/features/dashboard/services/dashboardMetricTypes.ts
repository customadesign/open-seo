import type { AiVisibilityState } from "@/server/features/ai-visibility/services/AiVisibilityService";

// ---------------------------------------------------------------------------
// View-model types for the seven summary metrics at the top of the project
// dashboard, plus the delta helpers every builder shares. Kept apart from the
// builders so the AI and non-AI builder modules can both depend on them
// without importing each other.
// ---------------------------------------------------------------------------

export const DASHBOARD_METRIC_KEYS = [
  "ai_visibility",
  "mentions",
  "site_health",
  "visibility",
  "organic_traffic",
  "organic_keywords",
  "backlinks",
] as const;

export type DashboardMetricKey = (typeof DASHBOARD_METRIC_KEYS)[number];

/**
 * - `ready`       — a measured value is present.
 * - `setup`       — the user must do something (set a domain, run an audit,
 *                   start tracking keywords) before this can be measured.
 * - `collecting`  — set up, first data not in yet.
 * - `unavailable` — we cannot measure it right now (plan/credits, or every
 *                   provider failed). Never rendered as zero.
 */
export type DashboardMetricStatus =
  | "ready"
  | "setup"
  | "collecting"
  | "unavailable";

/**
 * How to read `delta`:
 * - `percentage_points` — change in a percentage-valued metric (visibility went
 *   from 12% to 15% ⇒ +3pp). Reporting that as "+25%" would be misleading.
 * - `percent` — relative change against the previous value.
 * - `absolute` — raw change in a count.
 */
export type DashboardMetricDeltaKind =
  | "percentage_points"
  | "percent"
  | "absolute";

export type DashboardMetricUnit = "percent" | "count" | "score";

/**
 * Where "Set up" / "More details" points. A route key rather than a URL: the
 * client resolves it through a typed TanStack `Link`, so a renamed route is a
 * compile error instead of a dead link.
 */
export type DashboardMetricTarget =
  | "audit"
  | "rank-tracking"
  | "domain"
  | "backlinks"
  | "billing"
  | "settings";

export interface DashboardMetric {
  key: DashboardMetricKey;
  label: string;
  value: number | null;
  unit: DashboardMetricUnit;
  delta: number | null;
  deltaKind: DashboardMetricDeltaKind;
  /** When the underlying snapshot/attempt happened; null when none exists. */
  capturedAt: string | null;
  sourceLabel: string;
  /** True when the number is a modelled estimate, not a measurement. */
  estimated: boolean;
  status: DashboardMetricStatus;
  target: DashboardMetricTarget | null;
  /** One short line explaining a non-ready status. */
  note: string | null;
}

export interface DashboardSiteHealthSource {
  score: number | null;
  previousScore: number | null;
  pagesCrawled: number;
  capturedAt: string;
}

export interface DashboardVisibilitySource {
  current: number | null;
  previous: number | null;
  trackedKeywords: number;
  capturedAt: string | null;
}

export interface DashboardDomainOverviewSource {
  organicTraffic: number | null;
  organicKeywords: number | null;
  previousOrganicTraffic: number | null;
  previousOrganicKeywords: number | null;
  capturedAt: string;
}

export interface DashboardBacklinkMetricSource {
  backlinks: number | null;
  previousBacklinks: number | null;
  capturedAt: string;
}

export interface DashboardMetricSources {
  hasDomain: boolean;
  aiVisibility: AiVisibilityState;
  siteHealth: DashboardSiteHealthSource | null;
  visibility: DashboardVisibilitySource | null;
  domainOverview: DashboardDomainOverviewSource | null;
  backlinks: DashboardBacklinkMetricSource | null;
}

export const NO_DOMAIN_NOTE =
  "Set your project domain to start collecting this.";

export function percentChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function absoluteChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}
