import type {
  CrawledPageResult,
  PageFetchClass,
  PageResponseHeaders,
} from "@/server/lib/audit/types";
import { sha256Hex } from "@/server/lib/audit/ids";
import { HTML_SIZE_TOO_LARGE_BYTES } from "@/server/lib/audit/issues/thresholds";
import { normalizeUrl } from "@/server/lib/audit/url-utils";

const CRAWL_USER_AGENT = "OpenSEO-Audit/1.0";
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_HTML_MEASURE_BYTES = HTML_SIZE_TOO_LARGE_BYTES + 1;

/**
 * Markers of a bot-mitigation challenge page. We classify these honestly as
 * "blocked" instead of recording the challenge HTML as if it were the page.
 */
const CHALLENGE_BODY_MARKERS = [
  "just a moment...",
  "challenge-platform",
  "cf-browser-verification",
  "attention required! | cloudflare",
  "verifying you are human",
];

function classifyFetch(
  statusCode: number,
  headers: Headers,
  bodySnippet: string,
): PageFetchClass {
  if (statusCode === 0) return "error";
  if (headers.get("cf-mitigated")) return "blocked";
  if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
    return "blocked";
  }
  if (statusCode === 503) {
    const snippet = bodySnippet.toLowerCase();
    if (CHALLENGE_BODY_MARKERS.some((marker) => snippet.includes(marker))) {
      return "blocked";
    }
  }
  return "ok";
}

/** Parse `Link: <url>; rel="canonical"` response headers. */
function parseLinkHeaderCanonical(
  linkHeader: string | null,
  pageUrl: string,
): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;([^]*)/);
    if (!match) continue;
    if (/rel\s*=\s*"?canonical"?/i.test(match[2])) {
      return normalizeUrl(match[1].trim(), pageUrl);
    }
  }
  return null;
}

export async function crawlPage(
  url: string,
  crawlDepth: number | null,
  inSitemap: boolean,
): Promise<CrawledPageResult> {
  const startTime = Date.now();

  try {
    // Manual redirect handling: each hop is recorded as its own page row and
    // its target is enqueued by the frontier, so redirect chains and loops are
    // detectable from the recorded rows. Trailing-slash redirects (/docs ->
    // /docs/) need no special handling: normalizeUrl preserves trailing
    // slashes, so /docs and /docs/ are distinct URLs and the redirect resolves
    // to its canonical target instead of cycling back to its own source.
    const response = await fetch(url, {
      headers: {
        "User-Agent": CRAWL_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });

    const responseTimeMs = Date.now() - startTime;
    const statusCode = response.status;
    const responseHeaders = readPageResponseHeaders(response.headers);
    const xRobotsTag = responseHeaders.xRobotsTag;
    const headerCanonicalUrl = parseLinkHeaderCanonical(
      response.headers.get("link"),
      url,
    );

    if (statusCode >= 300 && statusCode < 400) {
      const location = response.headers.get("location");
      const redirectUrl = location ? normalizeUrl(location, url) : null;
      return emptyPageResult({
        url,
        statusCode,
        fetchClass: "ok",
        redirectUrl,
        responseTimeMs,
        responseHeaders,
        headerCanonicalUrl,
        crawlDepth,
        inSitemap,
      });
    }

    const contentType = responseHeaders.contentType ?? "";
    const isHtml = contentType.includes("text/html");
    // Cap what we parse: the first 1 MiB still contains the SEO metadata and
    // navigation needed by the audit in normal documents. Keep counting
    // discarded bytes up to the HTML-size check so oversized pages are visible.
    const { text: body, htmlBytes } = isHtml
      ? await readHtmlCapped(response, MAX_HTML_BYTES, MAX_HTML_MEASURE_BYTES)
      : { text: "", htmlBytes: 0 };
    const fetchClass = classifyFetch(
      statusCode,
      response.headers,
      body.slice(0, 4_000),
    );

    if (!isHtml || fetchClass !== "ok" || statusCode >= 400) {
      return emptyPageResult({
        url,
        statusCode,
        fetchClass,
        redirectUrl: null,
        responseTimeMs,
        responseHeaders,
        headerCanonicalUrl,
        crawlDepth,
        inSitemap,
        // The body was still fetched and buffered; report its size so the
        // crawl window's byte budget sees blocked/error pages too.
        htmlBytes,
      });
    }

    // Dynamic import keeps the HTML parser out of the worker's startup
    // module graph: SiteAuditWorkflow is re-exported from src/server.ts, so
    // a static import would evaluate it in every isolate's baseline heap,
    // not just when an audit actually crawls.
    const { analyzeHtml } = await import("@/server/lib/audit/page-analyzer");
    const analysis = analyzeHtml(body, url, statusCode, responseTimeMs, {
      responseHeaders,
    });
    const robotsDirectives = [analysis.robotsMeta, xRobotsTag]
      .filter(Boolean)
      .join(",")
      .toLowerCase();
    const isIndexable = !robotsDirectives.includes("noindex");
    const headingCount = (level: number) =>
      analysis.headingOrder.filter((h) => h === level).length;

    return {
      id: crypto.randomUUID(),
      url,
      statusCode,
      fetchClass,
      redirectUrl: null,
      title: analysis.title,
      metaDescription: analysis.metaDescription,
      canonicalUrl: analysis.canonical
        ? (normalizeUrl(analysis.canonical, url) ?? analysis.canonical)
        : null,
      robotsMeta: analysis.robotsMeta,
      xRobotsTag,
      headerCanonicalUrl,
      ogTitle: analysis.ogTitle,
      ogDescription: analysis.ogDescription,
      ogImage: analysis.ogImage,
      h1Count: analysis.h1s.filter((h) => h.length > 0).length,
      h2Count: headingCount(2),
      h3Count: headingCount(3),
      h4Count: headingCount(4),
      h5Count: headingCount(5),
      h6Count: headingCount(6),
      headingOrder: analysis.headingOrder,
      wordCount: analysis.wordCount,
      contentHash: analysis.bodyText
        ? await sha256Hex(analysis.bodyText)
        : null,
      isHtml: true,
      htmlBytes,
      hasDoctype: analysis.hasDoctype,
      charset: analysis.charset,
      hasMetaRefresh: analysis.hasMetaRefresh,
      frameCount: analysis.frameCount,
      scriptUrls: analysis.scriptUrls,
      stylesheetUrls: analysis.stylesheetUrls,
      inlineScriptBytes: analysis.inlineScriptBytes,
      inlineStyleBytes: analysis.inlineStyleBytes,
      textBytes: analysis.textBytes,
      externalImageSrcs: analysis.externalImageSrcs,
      responseHeaders,
      imagesTotal: analysis.images.length,
      // Only a truly absent alt attribute counts: alt="" is the correct
      // markup for decorative images.
      imagesMissingAlt: analysis.images.filter((img) => img.alt === null)
        .length,
      images: analysis.images,
      links: analysis.links,
      hasStructuredData: analysis.hasStructuredData,
      structuredDataTypes: analysis.structuredDataTypes,
      invalidStructuredDataCount: analysis.invalidStructuredDataCount,
      htmlLang: analysis.htmlLang,
      hasViewportMeta: analysis.hasViewportMeta,
      questionHeadingCount: analysis.questionHeadingCount,
      listCount: analysis.listCount,
      tableCount: analysis.tableCount,
      hasAuthorSignal: analysis.hasAuthorSignal,
      hasDateSignal: analysis.hasDateSignal,
      mixedContentCount: analysis.mixedContentCount,
      contentExternalLinkTargets: analysis.contentExternalLinkTargets,
      hreflangTags: analysis.hreflangTags,
      isIndexable,
      responseTimeMs,
      crawlDepth,
      inSitemap,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    console.warn(`Failed to crawl ${url}:`, error);
    return emptyPageResult({
      url,
      statusCode: 0,
      fetchClass: "error",
      redirectUrl: null,
      responseTimeMs,
      xRobotsTag: null,
      headerCanonicalUrl: null,
      crawlDepth,
      inSitemap,
    });
  }
}

function readPageResponseHeaders(headers: Headers): PageResponseHeaders {
  return {
    contentEncoding: headers.get("content-encoding"),
    cacheControl: headers.get("cache-control"),
    xRobotsTag: headers.get("x-robots-tag"),
    contentType: headers.get("content-type"),
  };
}

async function readHtmlCapped(
  response: Response,
  analyzeMaxBytes: number,
  measureMaxBytes: number,
): Promise<{ text: string; htmlBytes: number }> {
  if (!response.body) return { text: "", htmlBytes: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytesRead = 0;
  let analyzedBytes = 0;

  try {
    while (bytesRead < measureMaxBytes) {
      const { done, value } = await reader.read();
      if (done) break;

      const remaining = measureMaxBytes - bytesRead;
      const chunk =
        value.byteLength > remaining ? value.subarray(0, remaining) : value;
      bytesRead += chunk.byteLength;

      if (analyzedBytes < analyzeMaxBytes) {
        const take = Math.min(
          chunk.byteLength,
          analyzeMaxBytes - analyzedBytes,
        );
        parts.push(decoder.decode(chunk.subarray(0, take), { stream: true }));
        analyzedBytes += take;
        if (analyzedBytes >= analyzeMaxBytes) {
          parts.push(decoder.decode());
        }
      }

      if (bytesRead >= measureMaxBytes) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (analyzedBytes < analyzeMaxBytes) parts.push(decoder.decode());
  return { text: parts.join(""), htmlBytes: bytesRead };
}

function emptyPageResult(input: {
  url: string;
  statusCode: number;
  fetchClass: PageFetchClass;
  redirectUrl: string | null;
  responseTimeMs: number;
  xRobotsTag?: string | null;
  responseHeaders?: PageResponseHeaders;
  headerCanonicalUrl: string | null;
  crawlDepth: number | null;
  inSitemap: boolean;
  htmlBytes?: number;
}): CrawledPageResult {
  const responseHeaders = input.responseHeaders ?? {
    contentEncoding: null,
    cacheControl: null,
    xRobotsTag: input.xRobotsTag ?? null,
    contentType: null,
  };
  return {
    id: crypto.randomUUID(),
    url: input.url,
    statusCode: input.statusCode,
    fetchClass: input.fetchClass,
    redirectUrl: input.redirectUrl,
    title: "",
    metaDescription: "",
    canonicalUrl: null,
    robotsMeta: null,
    xRobotsTag: responseHeaders.xRobotsTag,
    headerCanonicalUrl: input.headerCanonicalUrl,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    h1Count: 0,
    h2Count: 0,
    h3Count: 0,
    h4Count: 0,
    h5Count: 0,
    h6Count: 0,
    headingOrder: [],
    wordCount: 0,
    contentHash: null,
    isHtml: false,
    htmlBytes: input.htmlBytes ?? 0,
    imagesTotal: 0,
    imagesMissingAlt: 0,
    images: [],
    links: [],
    hasStructuredData: false,
    structuredDataTypes: [],
    invalidStructuredDataCount: 0,
    htmlLang: null,
    hasViewportMeta: false,
    questionHeadingCount: 0,
    listCount: 0,
    tableCount: 0,
    hasAuthorSignal: false,
    hasDateSignal: false,
    mixedContentCount: 0,
    contentExternalLinkTargets: [],
    hreflangTags: [],
    isIndexable: false,
    responseTimeMs: input.responseTimeMs,
    crawlDepth: input.crawlDepth,
    inSitemap: input.inSitemap,
    hasDoctype: false,
    charset: null,
    hasMetaRefresh: false,
    frameCount: 0,
    scriptUrls: [],
    stylesheetUrls: [],
    inlineScriptBytes: 0,
    inlineStyleBytes: 0,
    textBytes: 0,
    externalImageSrcs: [],
    responseHeaders,
  };
}
