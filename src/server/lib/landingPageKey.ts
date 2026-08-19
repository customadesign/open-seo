/**
 * Shared landing-page join key for GA4, Search Console, and rank snapshots.
 *
 * Used by Search Opportunities and Organic Traffic Insights so the two pages
 * cannot disagree about which URLs are the same page.
 *
 * Always applied:
 * - Host is lowercased. DNS names are case-insensitive.
 * - A leading `www.` is stripped. GA4 `hostName`, GSC property URLs, and
 *   rank-tracking targets disagree about www vs apex for the same site; the
 *   join is answering "is this the same page?", not "did the request use www".
 * - Default ports (80/443) are dropped; a non-default port stays in the key.
 * - A trailing slash is dropped except on `/`.
 * - The query string is dropped. Campaign tags and most storefront parameters
 *   are not distinct landing pages for this join; parameterized URLs are
 *   grouped by path. Callers that show the joined numbers should say so.
 * - `(not set)`, `(other)`, and other `(...)` dimension placeholders are
 *   unjoinable.
 *
 * Path casing is preserved. `/Services` and `/services` are different keys.
 * Callers join two sources with `matchLandingPageKey`, which tries the exact
 * key first and only then a unique case-insensitive fallback.
 */
export function landingPageKey(
  value: string,
  hostHint?: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^\([^)]+\)$/.test(trimmed)) return null;

  try {
    const url = parseLandingPageUrl(trimmed, hostHint);
    if (!url) return null;

    let host = url.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    const defaultPort =
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443");
    if (url.port && !defaultPort) host += `:${url.port}`;
    if (!host) return null;

    let path = url.pathname || "/";
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/**
 * Find `key` in another source's keys. Exact match wins so `/Services` and
 * `/services` stay separate when both exist. A case-insensitive match is used
 * only when it is unique — a GA4/GSC casing mismatch still joins, but two
 * live case-variant pages are never collapsed.
 */
export function matchLandingPageKey(
  keys: Iterable<string>,
  key: string,
): string | undefined {
  let foldedMatch: string | undefined;
  let foldedAmbiguous = false;
  const folded = key.toLowerCase();
  for (const candidate of keys) {
    if (candidate === key) return key;
    if (foldedAmbiguous || candidate.toLowerCase() !== folded) continue;
    if (foldedMatch !== undefined) {
      foldedMatch = undefined;
      foldedAmbiguous = true;
      continue;
    }
    foldedMatch = candidate;
  }
  return foldedMatch;
}

function parseLandingPageUrl(value: string, hostHint?: string): URL | null {
  if (value.includes("://")) return new URL(value);

  const looksLikeHostPath = !value.startsWith("/") && value.includes(".");
  if (looksLikeHostPath) return new URL(`https://${value}`);

  const host = hostHint?.trim();
  if (!host) return null;
  const path = value.startsWith("/") ? value : `/${value}`;
  return new URL(`https://${host}${path}`);
}
