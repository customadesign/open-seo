/**
 * The report section catalogue, kept free of zod so the client bundle and the
 * Drizzle column definitions can both import it. `monthly_report_sections`
 * and `monthly_report_delivery_profile_sections` store `section_key` as plain
 * text on SQLite and Postgres alike, so this list is the only definition of a
 * valid key — extending it needs no migration on either dialect.
 */
export const REPORT_SECTION_KEYS = [
  "rankings",
  "gsc",
  "ga4",
  "google_ads",
  "audit",
  "backlinks",
  "ai_visibility",
  "local_geo_grid",
] as const;

export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

export const REPORT_SECTION_LABELS: Record<ReportSectionKey, string> = {
  rankings: "Search rankings",
  gsc: "Google Search Console",
  ga4: "Google Analytics",
  google_ads: "Google Ads",
  audit: "Site health",
  backlinks: "Backlinks",
  ai_visibility: "AI visibility",
  local_geo_grid: "Local map rankings",
};

type ReportSectionSelection = {
  key: ReportSectionKey;
  enabled: boolean;
};

const KNOWN_SECTION_KEYS = new Set<string>(REPORT_SECTION_KEYS);

function isReportSectionKey(value: string): value is ReportSectionKey {
  return KNOWN_SECTION_KEYS.has(value);
}

/**
 * Rows written before a section existed simply have no entry for it, so the
 * stored selection can be shorter than the catalogue. Missing keys are appended
 * **disabled**: a report an agency already sends to a client must not silently
 * gain a section because the product shipped one. Enabling stays an explicit
 * operator action.
 *
 * Unknown keys from a newer deployment are dropped rather than surfaced, so an
 * older build cannot offer a toggle it has no renderer for.
 */
export function mergeReportSections(
  stored: ReadonlyArray<{ key: string; enabled: boolean }>,
): ReportSectionSelection[] {
  const seen = new Set<string>();
  const merged: ReportSectionSelection[] = [];
  for (const section of stored) {
    if (!isReportSectionKey(section.key) || seen.has(section.key)) continue;
    seen.add(section.key);
    merged.push({ key: section.key, enabled: section.enabled });
  }
  for (const key of REPORT_SECTION_KEYS) {
    if (!seen.has(key)) merged.push({ key, enabled: false });
  }
  return merged;
}
