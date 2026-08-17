/**
 * Label helpers for the stored-data report sections. Kept out of the .tsx so
 * the wording of an "unavailable" or stale state is unit-testable: these are
 * the strings that stop a reader mistaking a provider outage, or last
 * quarter's crawl, for this month's result.
 */

type ReportSectionFreshness = {
  capturedAt: string;
  ageDays: number;
  isStale: boolean;
};

function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(date);
}

/** Stale data still gets shown — it gets shown labelled, with its age. */
export function freshnessLabel(freshness: ReportSectionFreshness): string {
  const captured = `Captured ${formatDay(freshness.capturedAt)}`;
  return freshness.isStale
    ? `${captured} · ${freshness.ageDays} days before the period ended, so it predates this report`
    : captured;
}

/**
 * Share of prompts that were actually answered. Prompts no provider answered
 * are reported alongside, never inside the denominator: an outage is not
 * evidence that the brand went unmentioned.
 */
export function aiAnswerShareLabel(summary: {
  answered: number;
  unavailable: number;
  answerShare: number | null;
}): string {
  const unavailable =
    summary.unavailable > 0 ? `${summary.unavailable} unavailable` : "";
  if (summary.answerShare == null) {
    return unavailable
      ? `No answers returned · ${unavailable}`
      : "No answers returned";
  }
  const percent = new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(summary.answerShare);
  const base = `${percent} of ${summary.answered} answers`;
  return unavailable ? `${base} · ${unavailable}` : base;
}

// Keyed loosely so a snapshot written by a newer deployment can be looked up
// without a cast; `satisfies` still forces every known reason to have a label.
const UNAVAILABLE_REASON_LABELS: Record<string, string | undefined> = {
  no_completed_run: "no completed run on or before the period end",
  no_observations: "the latest run recorded no observations",
  no_cells: "the latest run scanned no grid points",
} satisfies Record<"no_completed_run" | "no_observations" | "no_cells", string>;

export function sectionUnavailableLabel(reason: string): string {
  return UNAVAILABLE_REASON_LABELS[reason] ?? "no usable stored data";
}

/**
 * Coverage moves between two stored runs. Returns null when either side is
 * missing so the UI shows "—" instead of implying a change from zero.
 */
export function coverageChange(
  current: number | null,
  previous: number | null | undefined,
): number | null {
  return current != null && previous != null ? current - previous : null;
}
