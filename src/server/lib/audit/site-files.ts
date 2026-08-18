/* eslint-disable max-lines -- robots parse, sitemap parse, and one-shot fetch stay in one module */
/**
 * One-shot robots.txt + sitemap fetches for a site audit run.
 *
 * Discovery uses this so later issue slices can read the snapshot without
 * re-fetching. Failures (missing, 5xx, malformed) are recorded as data,
 * never thrown.
 */
import { XMLParser } from "fast-xml-parser";
import { SITEMAP_MAX_BYTES } from "@/server/lib/audit/issues/thresholds";
import { fetchAuditDiscoveryResource } from "@/server/lib/audit/discovery-fetch";
import { isSameOrigin, normalizeUrl } from "@/server/lib/audit/url-utils";

const ROBOTS_FETCH_TIMEOUT_MS = 10_000;
const SITEMAP_FETCH_TIMEOUT_MS = 15_000;
const MAX_ROBOTS_TXT_BYTES = 500 * 1024;
const MAX_SITEMAP_PARSE_BYTES = 10 * 1024 * 1024;
const MAX_SITEMAP_DEPTH = 3;
const MAX_SITEMAP_DOCS = 300;
const SITEMAP_CONCURRENCY = 5;
const SITEMAP_RETRIES = 1;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: (name) => name === "sitemap" || name === "url",
});

export interface RobotsDisallow {
  userAgent: string;
  path: string;
}

export interface RobotsFileSnapshot {
  found: boolean;
  statusCode: number | null;
  text: string | null;
  parseError: string | null;
  hasSitemapDirective: boolean;
  sitemapUrls: string[];
  disallowedPaths: RobotsDisallow[];
}

export interface SitemapFileSnapshot {
  url: string;
  found: boolean;
  statusCode: number | null;
  parseError: string | null;
  entryCount: number;
  byteSize: number;
  httpUrlCount: number;
  isIndex: boolean;
  pageUrls: string[];
  nestedSitemapUrls: string[];
  timedOut: boolean;
}

export interface SiteFilesSnapshot {
  robots: RobotsFileSnapshot;
  sitemaps: SitemapFileSnapshot[];
}

/** Compact form safe to checkpoint as Workflow step state (no URL lists). */
export interface CompactSiteFilesSnapshot {
  robots: Omit<RobotsFileSnapshot, "text">;
  sitemaps: Array<
    Omit<SitemapFileSnapshot, "pageUrls" | "nestedSitemapUrls" | "timedOut">
  >;
}

const KNOWN_ROBOTS_FIELDS = new Set([
  "user-agent",
  "disallow",
  "allow",
  "crawl-delay",
  "sitemap",
  "host",
]);

export function compactSiteFiles(
  snapshot: SiteFilesSnapshot,
): CompactSiteFilesSnapshot {
  return {
    robots: {
      found: snapshot.robots.found,
      statusCode: snapshot.robots.statusCode,
      parseError: snapshot.robots.parseError,
      hasSitemapDirective: snapshot.robots.hasSitemapDirective,
      sitemapUrls: snapshot.robots.sitemapUrls,
      disallowedPaths: snapshot.robots.disallowedPaths,
    },
    sitemaps: snapshot.sitemaps.map((sitemap) => ({
      url: sitemap.url,
      found: sitemap.found,
      statusCode: sitemap.statusCode,
      parseError: sitemap.parseError,
      entryCount: sitemap.entryCount,
      byteSize: sitemap.byteSize,
      httpUrlCount: sitemap.httpUrlCount,
      isIndex: sitemap.isIndex,
    })),
  };
}

export function emptyRobotsSnapshot(): RobotsFileSnapshot {
  return {
    found: false,
    statusCode: null,
    text: null,
    parseError: null,
    hasSitemapDirective: false,
    sitemapUrls: [],
    disallowedPaths: [],
  };
}

export function validateRobotsTxt(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (
    /^\s*</.test(trimmed) ||
    /<(?:html|head|body|div|!doctype)\b/i.test(trimmed)
  ) {
    return "robots.txt looks like HTML";
  }

  let sawUserAgent = false;
  let sawGroupDirective = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = line.match(/^([A-Za-z][A-Za-z-]*)\s*:\s*(.*)$/);
    if (!match) return `invalid line: ${line.slice(0, 80)}`;

    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (!KNOWN_ROBOTS_FIELDS.has(field)) continue;

    if (field === "user-agent") {
      if (!value) return "empty User-agent";
      sawUserAgent = true;
      continue;
    }
    if (field === "sitemap") {
      if (!value) return "empty Sitemap URL";
      continue;
    }
    if (field === "host") continue;

    sawGroupDirective = true;
    if (!sawUserAgent) return `${field} appeared before any User-agent`;
  }

  if (sawGroupDirective && !sawUserAgent) {
    return "no User-agent directive";
  }
  return null;
}

export function parseRobotsFile(
  origin: string,
  text: string | null,
  statusCode: number | null,
): RobotsFileSnapshot {
  if (text === null) {
    return { ...emptyRobotsSnapshot(), statusCode };
  }

  const parseError = validateRobotsTxt(text);
  const sitemapUrls: string[] = [];
  const disallowedPaths: RobotsDisallow[] = [];
  let currentAgents: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = line.match(/^([A-Za-z][A-Za-z-]*)\s*:\s*(.*)$/);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();

    if (field === "user-agent") {
      if (value) currentAgents = [value];
      continue;
    }
    if (field === "sitemap" && value) {
      const resolved = normalizeUrl(value, origin);
      if (resolved) sitemapUrls.push(resolved);
      continue;
    }
    if (field === "disallow" && value && currentAgents.length > 0) {
      for (const userAgent of currentAgents) {
        disallowedPaths.push({ userAgent, path: value });
      }
    }
  }

  return {
    found: true,
    statusCode,
    text,
    parseError,
    hasSitemapDirective: sitemapUrls.length > 0,
    sitemapUrls: [...new Set(sitemapUrls)],
    disallowedPaths,
  };
}

export async function fetchRobotsFile(
  origin: string,
): Promise<RobotsFileSnapshot> {
  try {
    const { response } = await fetchAuditDiscoveryResource(
      `${origin}/robots.txt`,
      {
        headers: { "User-Agent": "OpenSEO-Audit/1.0" },
        signal: AbortSignal.timeout(ROBOTS_FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return {
        ...emptyRobotsSnapshot(),
        statusCode: response.status,
      };
    }
    const text = (await response.text()).slice(0, MAX_ROBOTS_TXT_BYTES);
    return parseRobotsFile(origin, text, response.status);
  } catch (error) {
    console.warn("Failed to fetch robots.txt:", error);
    return emptyRobotsSnapshot();
  }
}

function isProbablySitemapXml(
  contentType: string | null,
  body: string,
): boolean {
  if (contentType?.toLowerCase().includes("xml")) return true;
  const trimmed = body.trimStart().toLowerCase();
  return (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<urlset") ||
    trimmed.startsWith("<sitemapindex")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function getSitemapLocations(input: unknown): string[] {
  if (!input) return [];
  const entries = Array.isArray(input) ? input : [input];
  return entries
    .map((entry) => {
      if (isRecord(entry)) {
        const loc = entry["loc"];
        return typeof loc === "string" ? loc : null;
      }
      return null;
    })
    .filter((loc): loc is string => typeof loc === "string");
}

function getParsedSitemapSections(parsed: unknown): {
  sitemap: unknown;
  url: unknown;
} {
  if (!parsed || typeof parsed !== "object") {
    return { sitemap: undefined, url: undefined };
  }
  const root = parsed as {
    sitemapindex?: { sitemap?: unknown };
    urlset?: { url?: unknown };
  };
  return {
    sitemap: root.sitemapindex?.sitemap,
    url: root.urlset?.url,
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "name" in error && error.name === "TimeoutError";
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ body: string | null; bytesRead: number }> {
  if (!response.body) return { body: "", bytesRead: 0 };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { body: null, bytesRead: total };
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(joined), bytesRead: total };
}

function countHttpUrls(urls: string[]): number {
  return urls.filter((url) => url.toLowerCase().startsWith("http://")).length;
}

function emptySitemapSnapshot(
  url: string,
  extras: Partial<SitemapFileSnapshot> = {},
): SitemapFileSnapshot {
  return {
    url,
    found: false,
    statusCode: null,
    parseError: null,
    entryCount: 0,
    byteSize: 0,
    httpUrlCount: 0,
    isIndex: false,
    pageUrls: [],
    nestedSitemapUrls: [],
    timedOut: false,
    ...extras,
  };
}

export function parseSitemapXml(
  body: string,
  sitemapUrl: string,
  finalUrl: string,
): Pick<
  SitemapFileSnapshot,
  | "parseError"
  | "entryCount"
  | "httpUrlCount"
  | "isIndex"
  | "pageUrls"
  | "nestedSitemapUrls"
> {
  if (!isProbablySitemapXml(null, body)) {
    return {
      parseError: "not valid sitemap XML",
      entryCount: 0,
      httpUrlCount: 0,
      isIndex: false,
      pageUrls: [],
      nestedSitemapUrls: [],
    };
  }

  try {
    const parsed = xmlParser.parse(body) as unknown;
    const sections = getParsedSitemapSections(parsed);
    const nestedSitemapUrls = getSitemapLocations(sections.sitemap)
      .map((loc) => normalizeUrl(loc, finalUrl))
      .filter((loc): loc is string => loc !== null);
    const pageUrls = getSitemapLocations(sections.url)
      .map((loc) => normalizeUrl(loc, finalUrl))
      .filter((loc): loc is string => loc !== null);
    const isIndex = nestedSitemapUrls.length > 0 && pageUrls.length === 0;
    const listed = isIndex ? nestedSitemapUrls : pageUrls;
    if (listed.length === 0 && !sections.sitemap && !sections.url) {
      return {
        parseError: "sitemap XML is missing urlset or sitemapindex",
        entryCount: 0,
        httpUrlCount: 0,
        isIndex: false,
        pageUrls: [],
        nestedSitemapUrls: [],
      };
    }
    return {
      parseError: null,
      entryCount: listed.length,
      httpUrlCount: countHttpUrls(listed),
      isIndex,
      pageUrls,
      nestedSitemapUrls,
    };
  } catch (error) {
    return {
      parseError:
        error instanceof Error ? error.message : "sitemap XML parse error",
      entryCount: 0,
      httpUrlCount: 0,
      isIndex: false,
      pageUrls: [],
      nestedSitemapUrls: [],
    };
  }
}

export async function fetchSitemapFile(
  sitemapUrl: string,
): Promise<SitemapFileSnapshot> {
  const normalizedSitemapUrl = normalizeUrl(sitemapUrl);
  if (!normalizedSitemapUrl) {
    return emptySitemapSnapshot(sitemapUrl, {
      parseError: "invalid sitemap URL",
    });
  }

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= SITEMAP_RETRIES; attempt++) {
    try {
      const { response, finalUrl } = await fetchAuditDiscoveryResource(
        normalizedSitemapUrl,
        {
          headers: { "User-Agent": "OpenSEO-Audit/1.0" },
          signal: AbortSignal.timeout(SITEMAP_FETCH_TIMEOUT_MS),
        },
      );

      const contentLengthHeader = response.headers.get("content-length");
      const contentLength = contentLengthHeader
        ? Number.parseInt(contentLengthHeader, 10)
        : Number.NaN;
      const declaredSize = Number.isFinite(contentLength) ? contentLength : 0;

      if (!response.ok) {
        return emptySitemapSnapshot(normalizedSitemapUrl, {
          statusCode: response.status,
        });
      }

      if (declaredSize > SITEMAP_MAX_BYTES) {
        return emptySitemapSnapshot(normalizedSitemapUrl, {
          found: true,
          statusCode: response.status,
          byteSize: declaredSize,
        });
      }

      const { body, bytesRead } = await readBodyCapped(
        response,
        MAX_SITEMAP_PARSE_BYTES,
      );
      const byteSize = declaredSize > 0 ? declaredSize : bytesRead;

      if (body === null) {
        return emptySitemapSnapshot(normalizedSitemapUrl, {
          found: true,
          statusCode: response.status,
          byteSize: Math.max(byteSize, MAX_SITEMAP_PARSE_BYTES + 1),
        });
      }

      if (!isProbablySitemapXml(response.headers.get("content-type"), body)) {
        return emptySitemapSnapshot(normalizedSitemapUrl, {
          found: true,
          statusCode: response.status,
          byteSize,
          parseError: "not valid sitemap XML",
        });
      }

      const parsed = parseSitemapXml(body, normalizedSitemapUrl, finalUrl);
      return {
        url: normalizedSitemapUrl,
        found: true,
        statusCode: response.status,
        parseError: parsed.parseError,
        entryCount: parsed.entryCount,
        byteSize,
        httpUrlCount: parsed.httpUrlCount,
        isIndex: parsed.isIndex,
        pageUrls: parsed.pageUrls,
        nestedSitemapUrls: parsed.nestedSitemapUrls,
        timedOut: false,
      };
    } catch (error) {
      lastError = error;
      if (!isTimeoutError(error) || attempt === SITEMAP_RETRIES) {
        break;
      }
    }
  }

  return emptySitemapSnapshot(normalizedSitemapUrl, {
    timedOut: isTimeoutError(lastError),
  });
}

/**
 * Fetch robots.txt plus every sitemap discovered from it (and /sitemap.xml).
 * Used by discovery so the crawl and later detectors share one fetch.
 */
export async function fetchSiteFiles(
  origin: string,
): Promise<SiteFilesSnapshot> {
  const robots = await fetchRobotsFile(origin);
  const sitemapSources = new Set(robots.sitemapUrls);
  sitemapSources.add(`${origin}/sitemap.xml`);

  const queue: Array<{ url: string; depth: number }> = Array.from(
    sitemapSources,
  )
    .map((url) => normalizeUrl(url, origin))
    .filter((url): url is string => url !== null)
    .filter((url) => isSameOrigin(url, origin))
    .map((url) => ({ url, depth: MAX_SITEMAP_DEPTH }));

  const sitemaps: SitemapFileSnapshot[] = [];
  const seen = new Set<string>();

  while (queue.length > 0 && seen.size < MAX_SITEMAP_DOCS) {
    const batch = queue.splice(0, SITEMAP_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ url, depth }) => {
        const normalizedUrl = normalizeUrl(url);
        if (
          !normalizedUrl ||
          !isSameOrigin(normalizedUrl, origin) ||
          depth <= 0 ||
          seen.has(normalizedUrl)
        ) {
          return;
        }
        seen.add(normalizedUrl);
        const snapshot = await fetchSitemapFile(normalizedUrl);
        sitemaps.push(snapshot);
        if (depth <= 1) return;
        for (const nestedUrl of snapshot.nestedSitemapUrls) {
          if (!isSameOrigin(nestedUrl, origin)) continue;
          if (!seen.has(nestedUrl)) {
            queue.push({ url: nestedUrl, depth: depth - 1 });
          }
        }
      }),
    );
  }

  return { robots, sitemaps };
}
