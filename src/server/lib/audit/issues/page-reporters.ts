/**
 * Per-page issue reporters.
 *
 * Each reporter is a pure function over a single crawled page record —
 * DOM-free by design (HTML parsing runs once in crawlPage), so the engine works
 * over any crawl source that can produce a CrawledPageResult.
 *
 * Cross-page checks (duplicates, broken links, orphans, redirect chains)
 * live in multipage.ts and run over D1 after the crawl.
 */
import type { AuditIssueType } from "@/shared/audit-issues";
import type { CrawledPageResult } from "@/server/lib/audit/types";
import {
  HTML_SIZE_TOO_LARGE_BYTES,
  LOW_TEXT_TO_HTML_RATIO,
  URL_TOO_LONG_CHARS,
  URL_TOO_MANY_PARAMETERS,
} from "@/server/lib/audit/issues/thresholds";
import { shouldReportUncompressedHtml } from "@/server/lib/audit/issues/uncompressed-html";

export interface DetectedIssue {
  issueType: AuditIssueType;
  pageId: string | null;
  pageUrl: string;
  details?: Record<string, unknown>;
  /**
   * Distinguishes multiple issues of the same type on the same page
   * (e.g. one broken-internal-link issue per target). Part of the
   * deterministic row id, so step retries don't duplicate issues.
   */
  dedupeKey?: string;
}

const TITLE_MAX_CHARS = 60;
const TITLE_MIN_CHARS = 10;
const META_DESCRIPTION_MAX_CHARS = 160;
const META_DESCRIPTION_MIN_CHARS = 70;
const THIN_CONTENT_WORDS = 150;
const SLOW_RESPONSE_MS = 1500;
const DEEP_PAGE_DEPTH = 5;
const LONG_FORM_WORDS = 500;
const GENERIC_ANCHORS = new Set([
  "click here",
  "here",
  "learn more",
  "more",
  "read more",
  "view more",
  "details",
  "website",
  "this",
]);
const ARTICLE_SCHEMA_TYPES = new Set([
  "article",
  "blogposting",
  "newsarticle",
  "techarticle",
  "report",
]);
const ENTITY_SCHEMA_TYPES = new Set([
  "organization",
  "corporation",
  "airline",
  "educationalorganization",
  "governmentorganization",
  "ngo",
  "localbusiness",
  "animalshelter",
  "automotivebusiness",
  "childcare",
  "dentist",
  "drycleaningorlaundry",
  "emergencyservice",
  "employmentagency",
  "entertainmentbusiness",
  "financialservice",
  "foodestablishment",
  "governmentoffice",
  "healthandbeautybusiness",
  "homeandconstructionbusiness",
  "hvacbusiness",
  "electrician",
  "generalcontractor",
  "housepainter",
  "locksmith",
  "plumber",
  "roofingcontractor",
  "legalservice",
  "lodgingbusiness",
  "professionalservice",
  "medicalbusiness",
  "realestateagent",
  "store",
  "restaurant",
  "travelagency",
]);
const SOCIAL_SOURCE_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "youtube.com",
];

function hasHeadingLevelSkip(headingOrder: number[]): boolean {
  for (let i = 1; i < headingOrder.length; i++) {
    if (headingOrder[i] > headingOrder[i - 1] + 1) return true;
  }
  return false;
}

function normalizedSchemaTypes(page: CrawledPageResult): Set<string> {
  return new Set(page.structuredDataTypes.map((type) => type.toLowerCase()));
}

function isHomepage(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    return url.pathname === "/";
  } catch {
    return false;
  }
}

function isLikelyEditorialPage(
  page: CrawledPageResult,
  schemaTypes: Set<string>,
): boolean {
  if (Array.from(schemaTypes).some((type) => ARTICLE_SCHEMA_TYPES.has(type))) {
    return true;
  }
  try {
    const segments = new URL(page.url).pathname
      .toLowerCase()
      .split("/")
      .filter(Boolean);
    const editorialIndex = segments.findIndex((segment) =>
      [
        "blog",
        "article",
        "articles",
        "guide",
        "guides",
        "insights",
        "news",
        "resources",
      ].includes(segment),
    );
    return editorialIndex >= 0 && editorialIndex < segments.length - 1;
  } catch {
    return false;
  }
}

function isExternalSourceLink(targetUrl: string): boolean {
  try {
    const hostname = new URL(targetUrl).hostname.toLowerCase();
    return !SOCIAL_SOURCE_HOSTS.some(
      (socialHost) =>
        hostname === socialHost || hostname.endsWith(`.${socialHost}`),
    );
  } catch {
    return false;
  }
}

type ReportIssue = (
  issueType: AuditIssueType,
  details?: Record<string, unknown>,
) => void;

function queryParamCount(url: string): number {
  try {
    return [...new URL(url).searchParams].length;
  } catch {
    return 0;
  }
}

function urlPathHasUnderscores(url: string): boolean {
  try {
    return new URL(url).pathname.includes("_");
  } catch {
    return url.includes("_");
  }
}

function hasNoindexDirective(value: string | null): boolean {
  return value?.toLowerCase().includes("noindex") === true;
}

function reportUrlShape(page: CrawledPageResult, report: ReportIssue) {
  if (page.url.length > URL_TOO_LONG_CHARS) {
    report("url-too-long", { length: page.url.length });
  }
  if (urlPathHasUnderscores(page.url)) {
    report("url-has-underscores");
  }
  const parameterCount = queryParamCount(page.url);
  if (parameterCount > URL_TOO_MANY_PARAMETERS) {
    report("url-too-many-parameters", { parameterCount });
  }
}

function reportHeaderSignals(page: CrawledPageResult, report: ReportIssue) {
  if (hasNoindexDirective(page.responseHeaders.xRobotsTag ?? page.xRobotsTag)) {
    report("noindex-via-x-robots-tag", {
      xRobotsTag: page.responseHeaders.xRobotsTag ?? page.xRobotsTag,
    });
  }
  if (shouldReportUncompressedHtml(page)) {
    report("page-not-compressed");
  }
}

function reportDocumentSignals(page: CrawledPageResult, report: ReportIssue) {
  if (!page.hasDoctype) report("missing-doctype");
  if (!page.charset) report("missing-charset");
  if (page.hasMetaRefresh) report("meta-refresh-present");
  if (page.frameCount > 0) {
    report("page-has-frames", { frameCount: page.frameCount });
  }
  if (page.htmlBytes > HTML_SIZE_TOO_LARGE_BYTES) {
    report("html-size-too-large", { htmlBytes: page.htmlBytes });
  }
  if (
    page.htmlBytes > 0 &&
    page.textBytes / page.htmlBytes < LOW_TEXT_TO_HTML_RATIO
  ) {
    report("low-text-to-html-ratio", {
      textBytes: page.textBytes,
      htmlBytes: page.htmlBytes,
    });
  }
}

function reportTechnicalReadiness(
  page: CrawledPageResult,
  report: ReportIssue,
) {
  if (!page.url.toLowerCase().startsWith("https://")) {
    report("non-https-page");
  }
  if (!page.hasViewportMeta) report("missing-viewport");
  if (page.mixedContentCount > 0) {
    report("mixed-content", { resourceCount: page.mixedContentCount });
  }
  if (!page.htmlLang) report("missing-html-lang");
}

function reportSemanticReadiness(page: CrawledPageResult, report: ReportIssue) {
  const schemaTypes = normalizedSchemaTypes(page);
  if (page.invalidStructuredDataCount > 0) {
    report("invalid-json-ld", {
      invalidBlocks: page.invalidStructuredDataCount,
      detectedTypes: Array.from(schemaTypes),
    });
  }
  if (
    isHomepage(page.url) &&
    !Array.from(schemaTypes).some((type) => ENTITY_SCHEMA_TYPES.has(type))
  ) {
    report("missing-entity-schema");
  }

  const isEditorial = isLikelyEditorialPage(page, schemaTypes);
  if (
    isEditorial &&
    !Array.from(schemaTypes).some((type) => ARTICLE_SCHEMA_TYPES.has(type))
  ) {
    report("missing-article-schema");
  }

  const missingOpenGraph = [
    !page.ogTitle && "og:title",
    !page.ogDescription && "og:description",
    !page.ogImage && "og:image",
  ].filter((field): field is string => Boolean(field));
  if (missingOpenGraph.length > 0) {
    report("incomplete-open-graph", { missing: missingOpenGraph });
  }

  const genericAnchors = page.links.filter(
    (link) =>
      link.anchor && GENERIC_ANCHORS.has(link.anchor.trim().toLowerCase()),
  );
  if (genericAnchors.length > 0) {
    report("generic-link-anchor", {
      count: genericAnchors.length,
      examples: genericAnchors.slice(0, 5).map((link) => ({
        anchor: link.anchor,
        targetUrl: link.targetUrl,
      })),
    });
  }
  const emptyAnchors = page.links.filter((link) => !link.anchor);
  if (emptyAnchors.length > 0) {
    report("empty-link-anchor", {
      count: emptyAnchors.length,
      targetUrls: emptyAnchors.slice(0, 5).map((link) => link.targetUrl),
    });
  }

  if (isEditorial && page.wordCount >= LONG_FORM_WORDS) {
    if (
      page.questionHeadingCount === 0 &&
      page.listCount === 0 &&
      page.tableCount === 0
    ) {
      report("weak-answer-structure", { wordCount: page.wordCount });
    }
    if (!page.hasAuthorSignal) report("missing-author-attribution");
    if (!page.hasDateSignal) report("missing-freshness-signal");
    const externalSources = page.contentExternalLinkTargets.filter(
      (targetUrl) => isExternalSourceLink(targetUrl),
    );
    if (externalSources.length === 0) report("no-cited-sources");
  }
}

export function runPageReporters(page: CrawledPageResult): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const report = (
    issueType: AuditIssueType,
    details?: Record<string, unknown>,
  ) => issues.push({ issueType, pageId: page.id, pageUrl: page.url, details });

  if (page.fetchClass === "blocked") {
    report("blocked-page", { statusCode: page.statusCode });
    return issues;
  }
  if (page.fetchClass === "error") {
    return issues;
  }

  if (page.statusCode >= 500) {
    report("server-error", { statusCode: page.statusCode });
    return issues;
  }
  if (page.statusCode >= 400) {
    report("broken-page", { statusCode: page.statusCode });
    return issues;
  }
  // Redirects are normal on their own; chains/loops are flagged in multipage.
  if (page.statusCode >= 300) {
    return issues;
  }

  if (page.responseTimeMs > SLOW_RESPONSE_MS) {
    report("slow-response", { responseTimeMs: page.responseTimeMs });
  }

  reportUrlShape(page, report);
  reportHeaderSignals(page, report);

  // Content checks only make sense for analyzed HTML documents (a PDF has no
  // title tag to miss; an empty-shell HTML page very much does).
  if (!page.isHtml) {
    return issues;
  }

  reportDocumentSignals(page, report);
  reportTechnicalReadiness(page, report);

  // Titles
  if (!page.title) {
    report("missing-title");
  } else if (page.title.length > TITLE_MAX_CHARS) {
    report("title-too-long", { length: page.title.length });
  } else if (page.title.length < TITLE_MIN_CHARS) {
    report("title-too-short", { length: page.title.length });
  }

  // Meta description
  if (!page.metaDescription) {
    report("missing-meta-description");
  } else if (page.metaDescription.length > META_DESCRIPTION_MAX_CHARS) {
    report("meta-description-too-long", {
      length: page.metaDescription.length,
    });
  } else if (page.metaDescription.length < META_DESCRIPTION_MIN_CHARS) {
    report("meta-description-too-short", {
      length: page.metaDescription.length,
    });
  }

  // Headings
  if (page.h1Count === 0) {
    report("missing-h1");
  } else if (page.h1Count > 1) {
    report("multiple-h1", { h1Count: page.h1Count });
  }
  if (hasHeadingLevelSkip(page.headingOrder)) {
    report("heading-order-skip");
  }

  // Indexability + canonical signals
  if (!page.isIndexable) {
    report("noindex-page", {
      robotsMeta: page.robotsMeta,
      xRobotsTag: page.xRobotsTag,
    });
  }
  if (
    page.canonicalUrl &&
    page.headerCanonicalUrl &&
    page.canonicalUrl !== page.headerCanonicalUrl
  ) {
    report("canonical-conflict", {
      htmlCanonical: page.canonicalUrl,
      headerCanonical: page.headerCanonicalUrl,
    });
  }
  const effectiveCanonical = page.canonicalUrl ?? page.headerCanonicalUrl;
  if (effectiveCanonical && effectiveCanonical !== page.url) {
    report("canonicalized-page", { canonicalUrl: effectiveCanonical });
  }
  if (page.isIndexable && !effectiveCanonical) {
    report("missing-self-canonical");
  }

  // Content quality
  if (page.isIndexable && page.wordCount < THIN_CONTENT_WORDS) {
    report("thin-content", { wordCount: page.wordCount });
  }
  if (page.imagesMissingAlt > 0) {
    report("images-missing-alt", {
      imagesMissingAlt: page.imagesMissingAlt,
      imagesTotal: page.imagesTotal,
    });
  }

  reportSemanticReadiness(page, report);

  // Structure
  if (page.isIndexable && page.links.length === 0) {
    report("no-outgoing-links");
  }
  if (page.crawlDepth !== null && page.crawlDepth >= DEEP_PAGE_DEPTH) {
    report("deep-page", { crawlDepth: page.crawlDepth });
  }

  return issues;
}
