/**
 * Join key for GA4 landing paths, GSC page URLs, and rank-tracking target URLs.
 *
 * The contract: protocol, www, trailing slash, query string, and casing do not
 * create distinct pages. A path-only value needs a host hint (GA4 hostName).
 */
export function normalizeLandingPageKey(
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
    path = path.toLowerCase();
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return null;
  }
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
