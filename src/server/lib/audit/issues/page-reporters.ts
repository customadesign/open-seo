/* eslint-disable max-lines -- per-check reporters share one page-result entry point */
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
  CONTENT_OPTIMISATION_MAX_WORDS,
  CONTENT_OPTIMISATION_MIN_WORDS,
  HTML_SIZE_TOO_LARGE_BYTES,
  LINK_URL_TOO_LONG_CHARS,
  LOW_SEMANTIC_HTML_MIN_ELEMENTS,
  LOW_TEXT_TO_HTML_RATIO,
  OUTDATED_CONTENT_MAX_AGE_DAYS,
  TOO_MANY_ON_PAGE_LINKS,
  TOO_MANY_PAGE_ASSETS,
  TOO_MUCH_CONTENT_WORDS,
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
const RESOURCE_LINK_EXTENSIONS = new Set([
  "css",
  "js",
  "mjs",
  "cjs",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "ico",
  "avif",
  "woff",
  "woff2",
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

function linkPathExtension(targetUrl: string): string | null {
  try {
    const pathname = new URL(targetUrl).pathname;
    const dot = pathname.lastIndexOf(".");
    if (dot < 0) return null;
    return pathname.slice(dot + 1).toLowerCase();
  } catch {
    return null;
  }
}

function reportLinkSignals(page: CrawledPageResult, report: ReportIssue) {
  if (page.links.length > TOO_MANY_ON_PAGE_LINKS) {
    report("too-many-on-page-links", { linkCount: page.links.length });
  }

  const longLinks = page.links.filter(
    (link) => link.targetUrl.length > LINK_URL_TOO_LONG_CHARS,
  );
  if (longLinks.length > 0) {
    report("link-url-too-long", {
      count: longLinks.length,
      examples: longLinks.slice(0, 5).map((link) => link.targetUrl),
    });
  }

  const internalNofollow = page.links.filter(
    (link) => link.isInternal && link.isNofollow,
  );
  if (internalNofollow.length > 0) {
    report("internal-nofollow-outgoing", {
      count: internalNofollow.length,
      targetUrls: internalNofollow.slice(0, 5).map((link) => link.targetUrl),
    });
  }

  const externalNofollow = page.links.filter(
    (link) => !link.isInternal && link.isNofollow,
  );
  if (externalNofollow.length > 0) {
    report("external-nofollow-outgoing", {
      count: externalNofollow.length,
      targetUrls: externalNofollow.slice(0, 5).map((link) => link.targetUrl),
    });
  }

  const resourceLinks = page.links.filter((link) => {
    const ext = linkPathExtension(link.targetUrl);
    return ext !== null && RESOURCE_LINK_EXTENSIONS.has(ext);
  });
  if (resourceLinks.length > 0) {
    report("resource-as-page-link", {
      count: resourceLinks.length,
      targetUrls: resourceLinks.slice(0, 5).map((link) => link.targetUrl),
    });
  }

  if (page.malformedLinkHrefs.length > 0) {
    report("malformed-link-url", {
      count: page.malformedLinkHrefs.length,
      hrefs: page.malformedLinkHrefs.slice(0, 5),
    });
  }
}

const HREFLANG_CODE =
  /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i;

export function isValidHreflangCode(value: string): boolean {
  return HREFLANG_CODE.test(value.trim());
}

function languagePrefix(value: string): string {
  return value.trim().toLowerCase().split("-", 1)[0] ?? "";
}

function reportHreflangSignals(page: CrawledPageResult, report: ReportIssue) {
  const links =
    page.hreflangLinks.length > 0
      ? page.hreflangLinks
      : page.hreflangTags.map((lang) => ({ lang, href: null }));
  if (links.length === 0) return;

  const invalid = links.filter((link) => !isValidHreflangCode(link.lang));
  if (invalid.length > 0) {
    report("hreflang-value-error", {
      values: invalid.map((link) => link.lang).slice(0, 8),
    });
  }

  const byLang = new Map<string, Set<string>>();
  const byHref = new Map<string, Set<string>>();
  for (const link of links) {
    const lang = link.lang.trim().toLowerCase();
    const href = link.href;
    const langHrefs = byLang.get(lang) ?? new Set<string>();
    langHrefs.add(href ?? "");
    byLang.set(lang, langHrefs);
    if (href) {
      const hrefLangs = byHref.get(href) ?? new Set<string>();
      hrefLangs.add(lang);
      byHref.set(href, hrefLangs);
    }
  }
  const conflictingLangs = Array.from(byLang.entries())
    .filter(([, hrefs]) => hrefs.size > 1)
    .map(([lang]) => lang);
  if (conflictingLangs.length > 0) {
    report("hreflang-conflict", { languages: conflictingLangs });
  }

  const selfLangs = links
    .filter((link) => link.href && link.href === page.url)
    .map((link) => languagePrefix(link.lang))
    .filter((lang) => lang && lang !== "x");
  const htmlLang = page.htmlLang ? languagePrefix(page.htmlLang) : "";
  if (htmlLang && selfLangs.length > 0 && !selfLangs.includes(htmlLang)) {
    report("hreflang-language-mismatch", {
      htmlLang: page.htmlLang,
      hreflang: selfLangs,
    });
  }
}

function reportContentQuality(page: CrawledPageResult, report: ReportIssue) {
  const title = page.title.trim().toLowerCase().replace(/\s+/g, " ");
  const h1 = (page.h1Text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (title && h1 && title === h1) {
    report("duplicate-h1-title");
  }

  if (page.wordCount > TOO_MUCH_CONTENT_WORDS) {
    report("too-much-content", { wordCount: page.wordCount });
  }

  /**
   * Mid-length indexable pages whose on-page package is still incomplete.
   * Distinct from thin-content (too few words) and too-much-content (too
   * many). Fires when at least two structure gaps are present.
   */
  if (
    page.isIndexable &&
    page.wordCount >= CONTENT_OPTIMISATION_MIN_WORDS &&
    page.wordCount <= CONTENT_OPTIMISATION_MAX_WORDS
  ) {
    const gaps = [
      page.h1Count === 0 && "missing-h1",
      page.h2Count === 0 && "missing-h2",
      !page.metaDescription && "missing-meta-description",
      page.listCount === 0 && page.tableCount === 0 && "no-list-or-table",
    ].filter((gap): gap is string => Boolean(gap));
    if (gaps.length >= 2) {
      report("content-optimisation-needed", {
        wordCount: page.wordCount,
        gaps,
      });
    }
  }

  if (page.contentDate) {
    const ageMs = Date.now() - Date.parse(`${page.contentDate}T00:00:00Z`);
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (Number.isFinite(ageDays) && ageDays > OUTDATED_CONTENT_MAX_AGE_DAYS) {
      report("outdated-content", {
        contentDate: page.contentDate,
        ageDays: Math.floor(ageDays),
      });
    }
  }

  if (
    page.isIndexable &&
    page.semanticElementCount < LOW_SEMANTIC_HTML_MIN_ELEMENTS
  ) {
    report("low-semantic-html", {
      semanticElementCount: page.semanticElementCount,
    });
  }
}

function reportAssetCounts(page: CrawledPageResult, report: ReportIssue) {
  const fileCount = page.scriptUrls.length + page.stylesheetUrls.length;
  if (fileCount > TOO_MANY_PAGE_ASSETS) {
    report("too-many-page-assets", { fileCount });
  }
}

function reportHsts(page: CrawledPageResult, report: ReportIssue) {
  if (!page.url.toLowerCase().startsWith("https://")) return;
  if (!page.responseHeaders.strictTransportSecurity) {
    report("missing-hsts");
  }
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
    if (page.fetchErrorKind === "dns") {
      report("dns-resolution-failure");
    } else if (page.fetchErrorKind === "malformed") {
      report("malformed-url-failure");
    }
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
  // Redirects are inventoried here; chains/loops are flagged in multipage.
  if (page.statusCode >= 300) {
    if (page.statusCode === 301 || page.statusCode === 308) {
      report("permanent-redirect", {
        statusCode: page.statusCode,
        redirectUrl: page.redirectUrl,
      });
    } else {
      report("temporary-redirect", {
        statusCode: page.statusCode,
        redirectUrl: page.redirectUrl,
      });
    }
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
  reportLinkSignals(page, report);
  reportHreflangSignals(page, report);
  reportContentQuality(page, report);
  reportAssetCounts(page, report);
  reportHsts(page, report);

  // Structure
  if (page.isIndexable && page.links.length === 0) {
    report("no-outgoing-links");
  }
  if (page.crawlDepth !== null && page.crawlDepth >= DEEP_PAGE_DEPTH) {
    report("deep-page", { crawlDepth: page.crawlDepth });
  }

  return issues;
}
