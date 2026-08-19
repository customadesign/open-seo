/* eslint-disable max-lines, max-lines-per-function, complexity -- the streaming tokenizer keeps one explicit parser state machine to avoid a memory-heavy DOM and state indirection */
/**
 * HTML page analyzer using htmlparser2's streaming tokenizer.
 *
 * Extracts SEO-relevant data from a page's HTML: title, meta description,
 * headings, images, links, canonical, OG tags, structured data, robots meta,
 * word count, hreflang.
 *
 * Deliberately NOT a DOM parser: the previous cheerio implementation built a
 * full DOM (~5-10x the HTML's size) per page, and with 25 concurrent parses
 * on a 128MB isolate that was the audit engine's dominant OOM cause. The
 * tokenizer keeps only the accumulated text and extracted fields in memory.
 */
import { Parser } from "htmlparser2";
import { normalizeUrl, isSameOrigin } from "./url-utils";
import type {
  HreflangLink,
  PageAnalysis,
  PageLink,
  PageResponseHeaders,
} from "./types";

const SKIPPED_LINK_PROTOCOLS = /^(javascript:|mailto:|tel:|#)/;
/** Subtrees whose text is not visible content. */
const NON_CONTENT_TAGS = new Set(["script", "style", "noscript", "svg"]);
const HEADING_LEVELS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};
const MAX_ANCHOR_CHARS = 200;
const MAX_JSON_LD_CHARS = 100_000;
const CHROME_TAGS = new Set(["aside", "footer", "header", "nav"]);
const PRIMARY_CONTENT_TAGS = new Set(["article", "main"]);
const SEMANTIC_TAGS = new Set([
  "article",
  "aside",
  "footer",
  "header",
  "main",
  "nav",
  "section",
]);
const QUESTION_HEADING =
  /^(what|why|how|when|where|who|which|can|could|does|do|is|are|should|will)\b|\?$/i;

interface OpenAnchor {
  href: string;
  rel: string;
  text: string[];
  isContent: boolean;
}

function inspectStructuredData(
  value: unknown,
  signals: {
    types: Set<string>;
    author: boolean;
    date: boolean;
    dates: string[];
  },
) {
  if (Array.isArray(value)) {
    for (const item of value) inspectStructuredData(item, signals);
    return;
  }
  if (!isUnknownRecord(value)) return;
  const record = value;
  const type = record["@type"];
  if (typeof type === "string") signals.types.add(type);
  if (Array.isArray(type)) {
    for (const entry of type) {
      if (typeof entry === "string") signals.types.add(entry);
    }
  }
  if (record["author"] != null) signals.author = true;
  if (record["datePublished"] != null || record["dateModified"] != null) {
    signals.date = true;
  }
  for (const key of ["datePublished", "dateModified", "dateCreated"] as const) {
    const raw = record[key];
    if (typeof raw === "string") signals.dates.push(raw);
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      inspectStructuredData(child, signals);
    }
  }
}

/** Parse a date-like string to YYYY-MM-DD, or null if unusable. */
export function parseContentDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isoDay = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDay) {
    const parsed = Date.parse(`${isoDay[1]}T00:00:00Z`);
    return Number.isFinite(parsed) ? isoDay[1] : null;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function newestContentDate(values: string[]): string | null {
  let newest: string | null = null;
  for (const value of values) {
    const day = parseContentDate(value);
    if (day && (!newest || day > newest)) newest = day;
  }
  return newest;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const utf8 = new TextEncoder();

function utf8ByteLength(text: string): number {
  return utf8.encode(text).byteLength;
}

function detectDoctype(html: string): boolean {
  return /<!doctype\b/i.test(html.slice(0, 4_096));
}

function charsetFromContentType(content: string): string | null {
  const match = content.match(/charset\s*=\s*["']?([^\s"';]+)/i);
  return match?.[1]?.trim() || null;
}

function recordExternalImage(
  src: string | undefined,
  pageUrl: string,
  pageHost: string | null,
  externalImageSrcs: Set<string>,
) {
  if (!src) return;
  const resolved = normalizeUrl(src, pageUrl);
  if (!resolved || !pageHost) return;
  try {
    if (new URL(resolved).hostname.toLowerCase() !== pageHost) {
      externalImageSrcs.add(resolved);
    }
  } catch {
    // ignore unparseable image URLs
  }
}

const EMPTY_RESPONSE_HEADERS: PageResponseHeaders = {
  contentEncoding: null,
  cacheControl: null,
  expires: null,
  xRobotsTag: null,
  contentType: null,
  contentLength: null,
  strictTransportSecurity: null,
};

/**
 * Analyze an HTML string and extract all SEO-relevant data.
 */
export function analyzeHtml(
  html: string,
  pageUrl: string,
  statusCode: number,
  responseTimeMs: number,
  options: {
    redirectUrl?: string | null;
    responseHeaders?: PageResponseHeaders;
  } = {},
): PageAnalysis {
  const redirectUrl = options.redirectUrl ?? null;
  const responseHeaders = options.responseHeaders ?? EMPTY_RESPONSE_HEADERS;
  let title: string | null = null;
  let titleDepth = 0;
  let titleDone = false;
  // parse5 (the old DOM path) treats <noscript> content as raw text when
  // scripting is enabled; skip element extraction inside it to match.
  let noscriptDepth = 0;
  let metaDescription: string | null = null;
  let canonical: string | null = null;
  let robotsMeta: string | null = null;
  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  let ogImage: string | null = null;
  let hasStructuredData = false;
  const structuredDataTypes = new Set<string>();
  let invalidStructuredDataCount = 0;
  let jsonLdParts: string[] | null = null;
  let jsonLdChars = 0;
  let jsonLdTruncated = false;
  let htmlLang: string | null = null;
  let hasViewportMeta = false;
  let hasAuthorSignal = false;
  let hasDateSignal = false;
  let listCount = 0;
  let tableCount = 0;
  let mixedContentCount = 0;
  const contentExternalLinkTargets = new Set<string>();
  const isHttpsPage = pageUrl.toLowerCase().startsWith("https://");
  const hreflangTags: string[] = [];
  const hreflangLinks: HreflangLink[] = [];
  const contentDateValues: string[] = [];
  const malformedLinkHrefs: string[] = [];
  let semanticElementCount = 0;
  let charset: string | null = null;
  let hasMetaRefresh = false;
  let frameCount = 0;
  let inlineScriptBytes = 0;
  let inlineStyleBytes = 0;
  let scriptDepth = 0;
  let styleDepth = 0;
  const scriptUrls = new Set<string>();
  const stylesheetUrls = new Set<string>();
  const externalImageSrcs = new Set<string>();
  let pageHost: string | null = null;
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    pageHost = null;
  }

  const h1s: string[] = [];
  const headingOrder: number[] = [];
  const headingTexts: string[] = [];
  let openHeading: {
    level: number;
    parts: string[];
    isContent: boolean;
  } | null = null;

  const images: Array<{ src: string | null; alt: string | null }> = [];
  const linksByTarget = new Map<string, PageLink>();
  let openAnchor: OpenAnchor | null = null;

  // Visible text: prefer text inside an explicit <body>; when the document
  // never opens one (fragments), fall back to all non-head text. Both
  // exclude NON_CONTENT_TAGS subtrees.
  let suppressDepth = 0;
  let bodyDepth = 0;
  let headDepth = 0;
  let chromeDepth = 0;
  let primaryContentDepth = 0;
  let sawBody = false;
  const bodyParts: string[] = [];
  const fallbackParts: string[] = [];

  const handleMetaTag = (attribs: Record<string, string>) => {
    const content = attribs["content"];
    if (attribs["charset"]?.trim()) {
      charset ??= attribs["charset"].trim();
    }
    const httpEquiv = attribs["http-equiv"]?.toLowerCase();
    if (httpEquiv === "content-type" && content) {
      charset ??= charsetFromContentType(content);
    }
    if (httpEquiv === "refresh") {
      hasMetaRefresh = true;
    }
    if (attribs["name"] === "description") {
      metaDescription ??= content?.trim() ?? "";
    } else if (attribs["name"] === "robots") {
      robotsMeta ??= content ?? null;
    } else if (attribs["name"] === "viewport") {
      hasViewportMeta = Boolean(content?.trim());
    } else if (attribs["name"] === "author") {
      hasAuthorSignal ||= Boolean(content?.trim());
    } else if (attribs["property"] === "og:title") {
      ogTitle ??= content ?? null;
    } else if (attribs["property"] === "og:description") {
      ogDescription ??= content ?? null;
    } else if (attribs["property"] === "og:image") {
      ogImage ??= content ?? null;
    } else if (
      attribs["property"] === "article:published_time" ||
      attribs["property"] === "article:modified_time"
    ) {
      hasDateSignal ||= Boolean(content?.trim());
      if (content?.trim()) contentDateValues.push(content);
    }
  };

  const handleLinkTag = (attribs: Record<string, string>) => {
    if (attribs["rel"] === "canonical") {
      canonical ??= attribs["href"] ?? null;
    } else if (attribs["rel"] === "alternate" && attribs["hreflang"]) {
      hreflangTags.push(attribs["hreflang"]);
      const href = attribs["href"]?.trim() || null;
      hreflangLinks.push({
        lang: attribs["hreflang"],
        href: href ? (normalizeUrl(href, pageUrl) ?? href) : null,
      });
    }
    const relTokens = attribs["rel"]?.split(/\s+/) ?? [];
    if (relTokens.includes("author")) {
      hasAuthorSignal = true;
    }
    if (relTokens.includes("stylesheet") && attribs["href"]) {
      const resolved = normalizeUrl(attribs["href"], pageUrl);
      if (resolved) stylesheetUrls.add(resolved);
    }
  };

  const closeJsonLd = () => {
    if (!jsonLdParts) return;
    const raw = jsonLdParts.join("").trim();
    jsonLdParts = null;
    jsonLdChars = 0;
    const wasTruncated = jsonLdTruncated;
    jsonLdTruncated = false;
    if (wasTruncated) return;
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      const signals = {
        types: structuredDataTypes,
        author: hasAuthorSignal,
        date: hasDateSignal,
        dates: contentDateValues,
      };
      inspectStructuredData(parsed, signals);
      hasAuthorSignal = signals.author;
      hasDateSignal = signals.date;
    } catch {
      invalidStructuredDataCount += 1;
    }
  };

  const closeAnchor = () => {
    if (!openAnchor) return;
    const { href, rel, text } = openAnchor;
    const isContent = openAnchor.isContent;
    openAnchor = null;
    const resolved = normalizeUrl(href, pageUrl);
    if (!resolved) {
      malformedLinkHrefs.push(href.slice(0, 500));
      return;
    }
    const isInternal = isSameOrigin(resolved, pageUrl);
    if (isContent && !isInternal) contentExternalLinkTargets.add(resolved);
    if (linksByTarget.has(resolved)) return;
    const anchor = text
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_ANCHOR_CHARS);
    linksByTarget.set(resolved, {
      targetUrl: resolved,
      anchor: anchor || null,
      isInternal,
      isNofollow: rel.split(/\s+/).includes("nofollow"),
    });
  };

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (CHROME_TAGS.has(name)) chromeDepth += 1;
        if (PRIMARY_CONTENT_TAGS.has(name)) primaryContentDepth += 1;
        if (SEMANTIC_TAGS.has(name)) semanticElementCount += 1;
        const isContentContext =
          primaryContentDepth > 0 || (headDepth === 0 && chromeDepth === 0);

        if (isHttpsPage) {
          const rel = attribs["rel"]?.toLowerCase() ?? "";
          const resourceHref =
            name === "link" &&
            /(^|\s)(stylesheet|preload|modulepreload|icon)(\s|$)/.test(rel)
              ? attribs["href"]
              : undefined;
          for (const candidate of [
            attribs["src"],
            attribs["poster"],
            name === "form" ? attribs["action"] : undefined,
            resourceHref,
          ]) {
            if (candidate?.trim().toLowerCase().startsWith("http://")) {
              mixedContentCount += 1;
            }
          }
        }
        if (isContentContext && attribs["itemprop"] === "author") {
          hasAuthorSignal = true;
        }
        if (
          isContentContext &&
          (attribs["itemprop"] === "datePublished" ||
            attribs["itemprop"] === "dateModified")
        ) {
          hasDateSignal = true;
        }
        const classes = attribs["class"]?.toLowerCase() ?? "";
        if (
          isContentContext &&
          /(^|[\s_-])(author|byline)(?=[\s_-]|$)/.test(classes)
        ) {
          hasAuthorSignal = true;
        }
        if (NON_CONTENT_TAGS.has(name)) {
          suppressDepth += 1;
        }
        if (name === "noscript") noscriptDepth += 1;
        if (noscriptDepth > 0) return;
        switch (name) {
          case "title":
            // Ignore <title> inside <svg> — only the document title counts.
            if (!titleDone && suppressDepth === 0) {
              titleDepth += 1;
              if (title === null) title = "";
            }
            break;
          case "head":
            headDepth += 1;
            break;
          case "html":
            htmlLang ??= attribs["lang"]?.trim() || null;
            break;
          case "body":
            bodyDepth += 1;
            sawBody = true;
            break;
          case "meta":
            handleMetaTag(attribs);
            break;
          case "link":
            handleLinkTag(attribs);
            break;
          case "img":
            images.push({
              src: attribs["src"] ?? null,
              alt: "alt" in attribs ? attribs["alt"] : null,
            });
            recordExternalImage(
              attribs["src"],
              pageUrl,
              pageHost,
              externalImageSrcs,
            );
            if (openAnchor && attribs["alt"]?.trim()) {
              openAnchor.text.push(attribs["alt"]);
            }
            break;
          case "script":
            scriptDepth += 1;
            if (attribs["src"]) {
              const resolved = normalizeUrl(attribs["src"], pageUrl);
              if (resolved) scriptUrls.add(resolved);
            }
            if (
              attribs["type"]?.split(";", 1)[0].trim().toLowerCase() ===
              "application/ld+json"
            ) {
              hasStructuredData = true;
              jsonLdParts = [];
              jsonLdChars = 0;
              jsonLdTruncated = false;
            }
            break;
          case "style":
            styleDepth += 1;
            break;
          case "frame":
          case "frameset":
          case "iframe":
            frameCount += 1;
            break;
          case "ol":
          case "ul":
            if (isContentContext) listCount += 1;
            break;
          case "table":
            if (isContentContext) tableCount += 1;
            break;
          case "time":
            if (isContentContext) {
              hasDateSignal ||= Boolean(attribs["datetime"]?.trim());
              if (attribs["datetime"]?.trim()) {
                contentDateValues.push(attribs["datetime"]);
              }
            }
            break;
          case "a": {
            // HTML forbids nested <a>; browsers implicitly close the open
            // one, and the tokenizer has no tree correction, so mirror that.
            closeAnchor();
            const href = attribs["href"];
            if (href && !SKIPPED_LINK_PROTOCOLS.test(href)) {
              openAnchor = {
                href,
                rel: attribs["rel"]?.toLowerCase() ?? "",
                text: [],
                isContent: isContentContext,
              };
            }
            break;
          }
        }
        const headingLevel = HEADING_LEVELS[name];
        if (headingLevel !== undefined) {
          headingOrder.push(headingLevel);
          openHeading = {
            level: headingLevel,
            parts: [],
            isContent: isContentContext,
          };
        }
      },
      ontext(text) {
        if (jsonLdParts) {
          const remaining = MAX_JSON_LD_CHARS - jsonLdChars;
          if (remaining > 0) {
            jsonLdParts.push(text.slice(0, remaining));
            jsonLdChars += Math.min(text.length, remaining);
          }
          if (text.length > remaining) jsonLdTruncated = true;
          inlineScriptBytes += utf8ByteLength(text);
          return;
        }
        if (scriptDepth > 0) inlineScriptBytes += utf8ByteLength(text);
        if (styleDepth > 0) inlineStyleBytes += utf8ByteLength(text);
        if (suppressDepth > 0) return;
        if (titleDepth > 0) {
          if (title !== null) title += text;
          return;
        }
        if (openHeading) openHeading.parts.push(text);
        if (openAnchor) openAnchor.text.push(text);
        if (bodyDepth > 0) {
          bodyParts.push(text);
        } else if (headDepth === 0) {
          fallbackParts.push(text);
        }
      },
      onclosetag(name) {
        if (name === "script") {
          closeJsonLd();
          if (scriptDepth > 0) scriptDepth -= 1;
        }
        if (name === "style" && styleDepth > 0) styleDepth -= 1;
        if (NON_CONTENT_TAGS.has(name) && suppressDepth > 0) {
          suppressDepth -= 1;
        }
        if (name === "noscript" && noscriptDepth > 0) {
          noscriptDepth -= 1;
          return;
        }
        if (noscriptDepth > 0) return;
        if (name === "title" && titleDepth > 0) {
          titleDepth -= 1;
          if (titleDepth === 0) titleDone = true;
        }
        if (name === "head" && headDepth > 0) headDepth -= 1;
        if (name === "body" && bodyDepth > 0) bodyDepth -= 1;
        if (name === "a") closeAnchor();
        const headingLevel = HEADING_LEVELS[name];
        if (headingLevel !== undefined && openHeading) {
          const rawText = openHeading.parts.join("").trim();
          if (openHeading.isContent) {
            headingTexts.push(rawText.replace(/\s+/g, " "));
          }
          if (openHeading.level === 1) h1s.push(rawText);
          openHeading = null;
        }
        if (CHROME_TAGS.has(name) && chromeDepth > 0) chromeDepth -= 1;
        if (PRIMARY_CONTENT_TAGS.has(name) && primaryContentDepth > 0) {
          primaryContentDepth -= 1;
        }
      },
    },
    // Defaults (non-XML mode): lowercased tag/attribute names, decoded
    // entities — matching what the DOM-based implementation saw.
  );
  parser.write(html);
  parser.end();

  const rawText = (sawBody ? bodyParts : fallbackParts).join("");
  const bodyText = rawText.replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  return {
    url: pageUrl,
    statusCode,
    redirectUrl,
    responseTimeMs,
    title: (title ?? "").trim(),
    metaDescription: metaDescription ?? "",
    canonical,
    robotsMeta,
    ogTitle,
    ogDescription,
    ogImage,
    h1s,
    headingOrder,
    wordCount,
    bodyText,
    contentDate: newestContentDate(contentDateValues),
    semanticElementCount,
    images,
    links: Array.from(linksByTarget.values()),
    malformedLinkHrefs,
    hasStructuredData,
    structuredDataTypes: Array.from(structuredDataTypes).toSorted(),
    invalidStructuredDataCount,
    htmlLang,
    hasViewportMeta,
    questionHeadingCount: headingTexts.filter((heading) =>
      QUESTION_HEADING.test(heading),
    ).length,
    listCount,
    tableCount,
    hasAuthorSignal,
    hasDateSignal,
    mixedContentCount,
    contentExternalLinkTargets: Array.from(contentExternalLinkTargets),
    hreflangTags,
    hreflangLinks,
    htmlBytes: utf8ByteLength(html),
    hasDoctype: detectDoctype(html),
    charset,
    hasMetaRefresh,
    frameCount,
    scriptUrls: Array.from(scriptUrls),
    stylesheetUrls: Array.from(stylesheetUrls),
    inlineScriptBytes,
    inlineStyleBytes,
    textBytes: utf8ByteLength(bodyText),
    imageCount: images.length,
    externalImageSrcs: Array.from(externalImageSrcs),
    responseHeaders,
  };
}
