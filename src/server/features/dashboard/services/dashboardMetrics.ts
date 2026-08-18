import {
  buildAiVisibilityMetric,
  buildMentionsMetric,
} from "@/server/features/dashboard/services/dashboardAiMetrics";
import {
  absoluteChange,
  NO_DOMAIN_NOTE,
  percentChange,
  type DashboardDomainOverviewSource,
  type DashboardMetric,
  type DashboardMetricDeltaKind,
  type DashboardMetricKey,
  type DashboardMetricSources,
} from "@/server/features/dashboard/services/dashboardMetricTypes";

// Builders for the metrics that come from our own crawls, rank snapshots and
// domain/backlink snapshots. Pure: every input is already-read cached data, so
// what a card says is decided in one testable place. Formatting stays on the
// client (locale-aware); the view model carries numbers, the shape of the delta,
// and the state the card should render in.

const DATAFORSEO_ESTIMATE_LABEL = "DataForSEO estimate";

function buildSiteHealthMetric(
  sources: DashboardMetricSources,
): DashboardMetric {
  const health = sources.siteHealth;
  const base = {
    key: "site_health",
    label: "Site Health",
    unit: "score",
    deltaKind: "percentage_points",
    sourceLabel: "Site audit",
    estimated: false,
    target: "audit",
  } as const;

  if (!health) {
    return {
      ...base,
      value: null,
      delta: null,
      capturedAt: null,
      status: "setup",
      note: "Run a site audit to score your site's health.",
    };
  }
  if (health.score === null) {
    return {
      ...base,
      value: null,
      delta: null,
      capturedAt: health.capturedAt,
      // A completed audit that crawled nothing has no health to report; zero
      // would read as a perfectly broken site.
      status: "unavailable",
      note: "The last audit crawled no pages.",
    };
  }

  return {
    ...base,
    value: health.score,
    delta: absoluteChange(health.score, health.previousScore),
    capturedAt: health.capturedAt,
    status: "ready",
    note: null,
  };
}

function buildVisibilityMetric(
  sources: DashboardMetricSources,
): DashboardMetric {
  const visibility = sources.visibility;
  const base = {
    key: "visibility",
    label: "Visibility",
    unit: "percent",
    deltaKind: "percentage_points",
    sourceLabel: "Rank tracking · volume-weighted",
    // Weighted by an aggregate CTR curve, so it models click potential rather
    // than measuring it.
    estimated: true,
    target: "rank-tracking",
  } as const;

  if (!visibility || visibility.trackedKeywords === 0) {
    return {
      ...base,
      value: null,
      delta: null,
      capturedAt: null,
      status: "setup",
      note: "Track keywords to see your search visibility.",
    };
  }
  if (visibility.current === null) {
    return {
      ...base,
      value: null,
      delta: null,
      capturedAt: visibility.capturedAt,
      // Volume-less keywords carry no click potential to weight.
      status: "collecting",
      note: "Waiting on search volume for your tracked keywords.",
    };
  }

  return {
    ...base,
    value: visibility.current,
    delta: absoluteChange(visibility.current, visibility.previous),
    capturedAt: visibility.capturedAt,
    status: "ready",
    note: null,
  };
}

function buildDomainOverviewMetric(
  sources: DashboardMetricSources,
  metric: {
    key: Extract<DashboardMetricKey, "organic_traffic" | "organic_keywords">;
    label: string;
    read: (source: DashboardDomainOverviewSource) => {
      value: number | null;
      previous: number | null;
    };
    deltaKind: DashboardMetricDeltaKind;
  },
): DashboardMetric {
  const base = {
    key: metric.key,
    label: metric.label,
    unit: "count",
    deltaKind: metric.deltaKind,
    sourceLabel: DATAFORSEO_ESTIMATE_LABEL,
    estimated: true,
    target: "domain",
  } as const;

  if (!sources.hasDomain) {
    return {
      ...base,
      value: null,
      delta: null,
      capturedAt: null,
      status: "setup",
      // The action is setting the project's domain, which lives in settings —
      // not the page this card links to once it has data.
      target: "settings",
      note: NO_DOMAIN_NOTE,
    };
  }
  if (!sources.domainOverview) {
    return {
      ...base,
      value: null,
      delta: null,
      capturedAt: null,
      status: "collecting",
      note: "Taking your first domain snapshot…",
    };
  }

  const { value, previous } = metric.read(sources.domainOverview);
  if (value === null) {
    return {
      ...base,
      value: null,
      delta: null,
      capturedAt: sources.domainOverview.capturedAt,
      status: "unavailable",
      note: "No organic data for this domain yet.",
    };
  }

  return {
    ...base,
    value,
    delta:
      metric.deltaKind === "percent"
        ? percentChange(value, previous)
        : absoluteChange(value, previous),
    capturedAt: sources.domainOverview.capturedAt,
    status: "ready",
    note: null,
  };
}

function buildBacklinksMetric(
  sources: DashboardMetricSources,
): DashboardMetric {
  const backlinks = sources.backlinks;
  const base = {
    key: "backlinks",
    label: "Backlinks",
    unit: "count",
    deltaKind: "absolute",
    sourceLabel: "DataForSEO backlinks",
    estimated: false,
    target: "backlinks",
  } as const;

  if (!sources.hasDomain) {
    return {
      ...base,
      value: null,
      delta: null,
      capturedAt: null,
      status: "setup",
      // The action is setting the project's domain, which lives in settings —
      // not the page this card links to once it has data.
      target: "settings",
      note: NO_DOMAIN_NOTE,
    };
  }
  if (!backlinks) {
    return {
      ...base,
      value: null,
      delta: null,
      capturedAt: null,
      status: "collecting",
      note: "Taking your first backlink snapshot…",
    };
  }
  if (backlinks.backlinks === null) {
    return {
      ...base,
      value: null,
      delta: null,
      capturedAt: backlinks.capturedAt,
      status: "unavailable",
      note: "The provider reported no backlink total.",
    };
  }

  return {
    ...base,
    value: backlinks.backlinks,
    delta: absoluteChange(backlinks.backlinks, backlinks.previousBacklinks),
    capturedAt: backlinks.capturedAt,
    status: "ready",
    note: null,
  };
}

/** Fixed order — the cards are a scoreboard, so they must not reshuffle. */
export function buildDashboardMetrics(
  sources: DashboardMetricSources,
): DashboardMetric[] {
  return [
    buildAiVisibilityMetric(sources),
    buildMentionsMetric(sources),
    buildSiteHealthMetric(sources),
    buildVisibilityMetric(sources),
    buildDomainOverviewMetric(sources, {
      key: "organic_traffic",
      label: "Organic Traffic",
      read: (source) => ({
        value: source.organicTraffic,
        previous: source.previousOrganicTraffic,
      }),
      // Traffic estimates move on a scale where the relative change is the
      // readable number.
      deltaKind: "percent",
    }),
    buildDomainOverviewMetric(sources, {
      key: "organic_keywords",
      label: "Organic Keywords",
      read: (source) => ({
        value: source.organicKeywords,
        previous: source.previousOrganicKeywords,
      }),
      deltaKind: "absolute",
    }),
    buildBacklinksMetric(sources),
  ];
}
