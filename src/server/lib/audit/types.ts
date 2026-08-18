/**
 * Shared types for the site audit system.
 */

import { z } from "zod";
import { MIN_AUDIT_PAGES, PAID_MAX_AUDIT_PAGES } from "@/shared/audit-limits";
import { jsonCodec } from "@/shared/json";

export type LighthouseStrategy = "auto" | "none";

export interface AuditConfig {
  maxPages: number;
  lighthouseStrategy: LighthouseStrategy;
}

// Read-side only (writes stringify a typed AuditConfig). Stored rows may hold
// retired strategies ("all", "manual") from older audits; map them onto the
// closest surviving strategy — and fall back to "auto" on anything unknown —
// instead of failing the whole config parse and making the audit's results
// unviewable.
const lighthouseStrategySchema = z
  .enum(["auto", "all", "manual", "none"])
  .transform(
    (value): LighthouseStrategy =>
      value === "all" ? "auto" : value === "manual" ? "none" : value,
  )
  .catch("auto");

const auditConfigSchema = z.object({
  maxPages: z.number().int().min(MIN_AUDIT_PAGES).max(PAID_MAX_AUDIT_PAGES),
  lighthouseStrategy: lighthouseStrategySchema,
});

const auditConfigCodec = jsonCodec(auditConfigSchema);

export function parseAuditConfig(configRaw: string | null): AuditConfig | null {
  if (!configRaw) return null;
  const result = auditConfigCodec.safeParse(configRaw);
  return result.success ? result.data : null;
}

/** How a page fetch resolved. "blocked" = WAF/bot challenge stood in the way. */
export type PageFetchClass = "ok" | "blocked" | "error";

/**
 * Why a fetchClass "error" page failed. Transient — used by page reporters
 * so DNS and malformed-URL failures are distinguishable. "network" is
 * everything else (timeout, connection reset) and is not a dedicated issue.
 */
export type PageFetchErrorKind = "dns" | "malformed" | "network";

/** One outgoing link edge, deduped by target URL within a page. */
export interface PageLink {
  targetUrl: string;
  anchor: string | null;
  isInternal: boolean;
  isNofollow: boolean;
}

/** One hreflang alternate, with the language code and resolved href. */
export interface HreflangLink {
  lang: string;
  href: string | null;
}

/** Response headers used by later audit checks. */
export interface PageResponseHeaders {
  contentEncoding: string | null;
  cacheControl: string | null;
  expires: string | null;
  xRobotsTag: string | null;
  contentType: string | null;
  contentLength: number | null;
  strictTransportSecurity: string | null;
}

/** Data extracted from a single page's HTML. */
export interface PageAnalysis {
  url: string;
  statusCode: number;
  redirectUrl: string | null;
  responseTimeMs: number;

  // Head metadata
  title: string;
  metaDescription: string;
  canonical: string | null;
  robotsMeta: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;

  // Headings
  h1s: string[];
  headingOrder: number[];

  // Content
  wordCount: number;
  bodyText: string;
  /** Newest parseable published/updated date as YYYY-MM-DD, if any. */
  contentDate: string | null;
  /** Count of landmark/sectioning elements (main, article, nav, …). */
  semanticElementCount: number;

  // Images
  images: Array<{ src: string | null; alt: string | null }>;

  // Links (normalized, deduped by target)
  links: PageLink[];
  /** hrefs that could not be resolved to an HTTP(S) URL. */
  malformedLinkHrefs: string[];

  // Structured data
  hasStructuredData: boolean;
  structuredDataTypes: string[];
  invalidStructuredDataCount: number;

  // Semantic/AEO/GEO signals (used by reporters; no raw content is stored)
  htmlLang: string | null;
  hasViewportMeta: boolean;
  questionHeadingCount: number;
  listCount: number;
  tableCount: number;
  hasAuthorSignal: boolean;
  hasDateSignal: boolean;
  mixedContentCount: number;
  contentExternalLinkTargets: string[];

  // Hreflang
  hreflangTags: string[];
  hreflangLinks: HreflangLink[];

  // Document / resource signals for later audit slices
  htmlBytes: number;
  hasDoctype: boolean;
  charset: string | null;
  hasMetaRefresh: boolean;
  frameCount: number;
  scriptUrls: string[];
  stylesheetUrls: string[];
  inlineScriptBytes: number;
  inlineStyleBytes: number;
  textBytes: number;
  imageCount: number;
  externalImageSrcs: string[];
  responseHeaders: PageResponseHeaders;
}

/** Lighthouse result for a single URL+strategy. */
export interface LighthouseResult {
  url: string;
  pageId: string;
  strategy: "mobile" | "desktop";
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  inpMs: number | null;
  ttfbMs: number | null;
  errorMessage?: string | null;
  r2Key?: string | null;
  payloadSizeBytes?: number | null;
}

/**
 * Full result of crawling one page. Persisted to the app DB inside the
 * crawl-chunk step; never accumulated in memory or returned as durable
 * step state.
 */
export interface CrawledPageResult {
  id: string;
  url: string;
  statusCode: number;
  fetchClass: PageFetchClass;
  /**
   * Set only when fetchClass is "error". Transient — not persisted.
   */
  fetchErrorKind: PageFetchErrorKind | null;
  redirectUrl: string | null;
  title: string;
  metaDescription: string;
  canonicalUrl: string | null;
  robotsMeta: string | null;
  xRobotsTag: string | null;
  headerCanonicalUrl: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  h1Count: number;
  /** First non-empty H1 text. Transient — used by page reporters. */
  h1Text: string | null;
  h2Count: number;
  h3Count: number;
  h4Count: number;
  h5Count: number;
  h6Count: number;
  headingOrder: number[];
  wordCount: number;
  contentDate: string | null;
  semanticElementCount: number;
  contentHash: string | null;
  /**
   * True when an HTML document was fetched and analyzed. Gates the content
   * checks in page reporters (an empty-shell HTML page must still be
   * checked; a PDF must not). Transient — not persisted.
   */
  isHtml: boolean;
  /**
   * HTML size read for this page (approximate; capped at MAX_HTML_BYTES).
   * Transient — feeds the crawl window's memory-pressure signal, since
   * response time is measured at headers and says nothing about body size.
   */
  htmlBytes: number;
  imagesTotal: number;
  imagesMissingAlt: number;
  images: Array<{ src: string | null; alt: string | null }>;
  links: PageLink[];
  malformedLinkHrefs: string[];
  hasStructuredData: boolean;
  structuredDataTypes: string[];
  invalidStructuredDataCount: number;
  htmlLang: string | null;
  hasViewportMeta: boolean;
  questionHeadingCount: number;
  listCount: number;
  tableCount: number;
  hasAuthorSignal: boolean;
  hasDateSignal: boolean;
  mixedContentCount: number;
  contentExternalLinkTargets: string[];
  hreflangTags: string[];
  hreflangLinks: HreflangLink[];
  isIndexable: boolean;
  responseTimeMs: number;
  /** null = not reached via links (e.g. sitemap-seeded). */
  crawlDepth: number | null;
  inSitemap: boolean;

  hasDoctype: boolean;
  charset: string | null;
  hasMetaRefresh: boolean;
  frameCount: number;
  scriptUrls: string[];
  stylesheetUrls: string[];
  inlineScriptBytes: number;
  inlineStyleBytes: number;
  textBytes: number;
  externalImageSrcs: string[];
  responseHeaders: PageResponseHeaders;
}
