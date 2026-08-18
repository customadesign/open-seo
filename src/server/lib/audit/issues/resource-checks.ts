/**
 * Finalize-time checks that need extra HTTP probes: external links, images,
 * JS/CSS assets, unchecked canonicals, and hreflang targets.
 *
 * Uses the shared bounded probe. A missing, slow, or unsafe target never
 * fails the audit — it is skipped or recorded as unreachable.
 */
import type { ScratchpadExternalLinkRow } from "@/server/features/audit/AuditScratchpad";
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";
import { isValidHreflangCode } from "@/server/lib/audit/issues/page-reporters";
import {
  PAGE_ASSETS_MAX_BYTES,
  UNCOMPRESSED_CONTENT_LENGTH_TOLERANCE_BYTES,
  UNMINIFIED_MIN_BYTES,
  UNMINIFIED_NEWLINE_RATIO,
} from "@/server/lib/audit/issues/thresholds";
import {
  isBrokenProbeStatus,
  probeStatusCode,
  type ResourceProbeStatus,
} from "@/server/lib/audit/resource-probe";
import type { HreflangLink } from "@/server/lib/audit/types";
import { isSameOrigin, normalizeUrl } from "@/server/lib/audit/url-utils";

export function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseStringList(raw: string | null): string[] {
  return parseJsonArray(raw).filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

export function parseImageSrcs(raw: string | null, pageUrl: string): string[] {
  const srcs: string[] = [];
  for (const item of parseJsonArray(raw)) {
    if (!item || typeof item !== "object" || !("src" in item)) continue;
    const src = (item as { src: unknown }).src;
    if (typeof src !== "string" || !src) continue;
    const resolved = normalizeUrl(src, pageUrl);
    if (resolved) srcs.push(resolved);
  }
  return srcs;
}

export function parseHreflangLinks(raw: string | null): HreflangLink[] {
  const links: HreflangLink[] = [];
  for (const item of parseJsonArray(raw)) {
    if (typeof item === "string") {
      links.push({ lang: item, href: null });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as { lang?: unknown; href?: unknown };
    if (typeof record.lang !== "string") continue;
    links.push({
      lang: record.lang,
      href: typeof record.href === "string" ? record.href : null,
    });
  }
  return links;
}

function isUnreachable(result: ResourceProbeStatus | undefined): boolean {
  return result?.kind === "unreachable";
}

function looksUnminified(source: string): boolean {
  if (source.length < UNMINIFIED_MIN_BYTES) return false;
  const newlines = (source.match(/\n/g) ?? []).length;
  return newlines / source.length > UNMINIFIED_NEWLINE_RATIO;
}

function hasCachePolicy(
  cacheControl: string | null,
  expires: string | null,
): boolean {
  return Boolean(cacheControl?.trim() || expires?.trim());
}

function isKnownUncompressed(
  contentEncoding: string | null,
  contentLength: number | null,
  bodyBytes: number,
): boolean {
  const tokens = (contentEncoding ?? "")
    .toLowerCase()
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.some((token) => token !== "identity")) return false;
  if (tokens.includes("identity")) return true;
  if (contentLength === null || bodyBytes <= 0) return false;
  return (
    Math.abs(contentLength - bodyBytes) <=
    UNCOMPRESSED_CONTENT_LENGTH_TOLERANCE_BYTES
  );
}

function emitForSources(
  issues: DetectedIssue[],
  sources: Array<{ sourcePageId: string; sourceUrl: string }>,
  issueType: DetectedIssue["issueType"],
  targetUrl: string,
  details: Record<string, unknown>,
) {
  for (const source of sources) {
    issues.push({
      issueType,
      pageId: source.sourcePageId,
      pageUrl: source.sourceUrl,
      dedupeKey: targetUrl,
      details: { targetUrl, ...details },
    });
  }
}

export function reportExternalLinkProbes(
  links: ScratchpadExternalLinkRow[],
  probes: Map<string, ResourceProbeStatus>,
): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const byTarget = new Map<string, ScratchpadExternalLinkRow[]>();
  for (const link of links) {
    const group = byTarget.get(link.targetUrl) ?? [];
    group.push(link);
    byTarget.set(link.targetUrl, group);
  }

  for (const [targetUrl, sources] of byTarget) {
    const result = probes.get(targetUrl);
    if (!result || result.kind === "skipped") continue;
    const statusCode = probeStatusCode(result);
    if (statusCode === 403) {
      emitForSources(issues, sources, "external-link-403", targetUrl, {
        targetStatus: 403,
      });
      continue;
    }
    if (isBrokenProbeStatus(statusCode) || isUnreachable(result)) {
      emitForSources(issues, sources, "broken-external-link", targetUrl, {
        targetStatus: statusCode,
        unreachable: isUnreachable(result),
      });
    }
  }
  return issues;
}

export function reportImageProbes(input: {
  pages: Array<{
    id: string;
    url: string;
    imageSrcs: string[];
  }>;
  origin: string;
  probes: Map<string, ResourceProbeStatus>;
}): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  for (const page of input.pages) {
    for (const src of page.imageSrcs) {
      const result = input.probes.get(src);
      if (!result || result.kind === "skipped") continue;
      const statusCode = probeStatusCode(result);
      if (!isBrokenProbeStatus(statusCode) && !isUnreachable(result)) continue;
      const isInternal = isSameOrigin(src, input.origin);
      issues.push({
        issueType: isInternal
          ? "broken-internal-image"
          : "broken-external-image",
        pageId: page.id,
        pageUrl: page.url,
        dedupeKey: src,
        details: {
          targetUrl: src,
          targetStatus: statusCode,
          unreachable: isUnreachable(result),
        },
      });
    }
  }
  return issues;
}

export function reportAssetProbes(input: {
  pages: Array<{
    id: string;
    url: string;
    scriptUrls: string[];
    stylesheetUrls: string[];
    inlineScriptBytes: number;
    inlineStyleBytes: number;
  }>;
  origin: string;
  probes: Map<string, ResourceProbeStatus>;
}): DetectedIssue[] {
  const issues: DetectedIssue[] = [];

  for (const page of input.pages) {
    let knownAssetBytes = page.inlineScriptBytes + page.inlineStyleBytes;

    const checkFiles = (urls: string[], kind: "javascript" | "css") => {
      for (const url of urls) {
        const result = input.probes.get(url);
        if (!result || result.kind === "skipped") continue;
        const statusCode = probeStatusCode(result);
        const isInternal = isSameOrigin(url, input.origin);
        if (isBrokenProbeStatus(statusCode) || isUnreachable(result)) {
          const issueType =
            kind === "javascript"
              ? isInternal
                ? "broken-internal-javascript"
                : "broken-external-javascript"
              : isInternal
                ? "broken-internal-css"
                : "broken-external-css";
          issues.push({
            issueType,
            pageId: page.id,
            pageUrl: page.url,
            dedupeKey: url,
            details: {
              targetUrl: url,
              targetStatus: statusCode,
              unreachable: isUnreachable(result),
            },
          });
          continue;
        }
        if (result.kind !== "inspect" && result.kind !== "ok") continue;
        const headers = result.headers;
        const body = result.kind === "inspect" ? result.body : "";
        const bodyBytes =
          result.kind === "inspect"
            ? result.bodyBytes
            : (headers.contentLength ?? 0);
        knownAssetBytes += bodyBytes;

        if (result.kind === "inspect" && looksUnminified(body)) {
          issues.push({
            issueType:
              kind === "javascript"
                ? "unminified-javascript"
                : "unminified-css",
            pageId: page.id,
            pageUrl: page.url,
            dedupeKey: url,
            details: { targetUrl: url, bodyBytes },
          });
        }
        if (
          isKnownUncompressed(
            headers.contentEncoding,
            headers.contentLength,
            bodyBytes,
          )
        ) {
          issues.push({
            issueType:
              kind === "javascript"
                ? "uncompressed-javascript"
                : "uncompressed-css",
            pageId: page.id,
            pageUrl: page.url,
            dedupeKey: url,
            details: { targetUrl: url },
          });
        }
        if (!hasCachePolicy(headers.cacheControl, headers.expires)) {
          issues.push({
            issueType:
              kind === "javascript" ? "uncached-javascript" : "uncached-css",
            pageId: page.id,
            pageUrl: page.url,
            dedupeKey: url,
            details: { targetUrl: url },
          });
        }
      }
    };

    checkFiles(page.scriptUrls, "javascript");
    checkFiles(page.stylesheetUrls, "css");

    if (knownAssetBytes > PAGE_ASSETS_MAX_BYTES) {
      issues.push({
        issueType: "page-assets-too-large",
        pageId: page.id,
        pageUrl: page.url,
        details: { assetBytes: knownAssetBytes },
      });
    }
  }

  return issues;
}

export function reportCanonicalProbes(input: {
  pages: Array<{
    id: string;
    url: string;
    canonicalUrl: string | null;
    headerCanonicalUrl: string | null;
    statusByUrl: Map<string, number>;
  }>;
  probes: Map<string, ResourceProbeStatus>;
}): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  for (const page of input.pages) {
    const canonical = page.canonicalUrl ?? page.headerCanonicalUrl;
    if (!canonical || canonical === page.url) continue;
    const crawledStatus = page.statusByUrl.get(canonical);
    if (crawledStatus !== undefined) {
      if (crawledStatus >= 400) {
        issues.push({
          issueType: "broken-canonical",
          pageId: page.id,
          pageUrl: page.url,
          dedupeKey: canonical,
          details: { canonicalUrl: canonical, targetStatus: crawledStatus },
        });
      }
      continue;
    }
    const result = input.probes.get(canonical);
    if (!result || result.kind === "skipped") continue;
    const statusCode = probeStatusCode(result);
    if (isBrokenProbeStatus(statusCode) || isUnreachable(result)) {
      issues.push({
        issueType: "broken-canonical",
        pageId: page.id,
        pageUrl: page.url,
        dedupeKey: canonical,
        details: {
          canonicalUrl: canonical,
          targetStatus: statusCode,
          unreachable: isUnreachable(result),
        },
      });
    }
  }
  return issues;
}

export function reportHreflangTargetProbes(input: {
  pages: Array<{
    id: string;
    url: string;
    links: HreflangLink[];
    statusByUrl: Map<string, number>;
    hreflangByUrl: Map<string, HreflangLink[]>;
  }>;
  probes: Map<string, ResourceProbeStatus>;
}): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  for (const page of input.pages) {
    for (const link of page.links) {
      if (!isValidHreflangCode(link.lang)) continue;
      if (!link.href) {
        issues.push({
          issueType: "incorrect-hreflang-link",
          pageId: page.id,
          pageUrl: page.url,
          dedupeKey: `${link.lang}:missing`,
          details: { lang: link.lang, reason: "missing-href" },
        });
        continue;
      }
      const crawledStatus = page.statusByUrl.get(link.href);
      const result = input.probes.get(link.href);
      const statusCode =
        crawledStatus ??
        (result && result.kind !== "skipped" ? probeStatusCode(result) : null);
      const unreachable = crawledStatus === undefined && isUnreachable(result);
      if (
        (statusCode !== null && statusCode !== 200) ||
        unreachable ||
        (crawledStatus === undefined &&
          result?.kind === "ok" &&
          statusCode !== 200)
      ) {
        if (statusCode !== 200 || unreachable) {
          issues.push({
            issueType: "incorrect-hreflang-link",
            pageId: page.id,
            pageUrl: page.url,
            dedupeKey: `${link.lang}:${link.href}`,
            details: {
              lang: link.lang,
              href: link.href,
              targetStatus: statusCode,
              reason: unreachable ? "unreachable" : "non-200",
            },
          });
          continue;
        }
      }
      const targetTags = page.hreflangByUrl.get(link.href);
      if (!targetTags) continue;
      const returns = targetTags.some(
        (other) =>
          other.href === page.url &&
          other.lang.trim().toLowerCase() === link.lang.trim().toLowerCase(),
      );
      if (!returns) {
        issues.push({
          issueType: "incorrect-hreflang-link",
          pageId: page.id,
          pageUrl: page.url,
          dedupeKey: `${link.lang}:${link.href}:reciprocal`,
          details: {
            lang: link.lang,
            href: link.href,
            reason: "not-reciprocal",
          },
        });
      }
    }
  }
  return issues;
}
