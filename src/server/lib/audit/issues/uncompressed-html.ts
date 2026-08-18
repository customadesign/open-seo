import { UNCOMPRESSED_CONTENT_LENGTH_TOLERANCE_BYTES } from "@/server/lib/audit/issues/thresholds";
import type { CrawledPageResult } from "@/server/lib/audit/types";

function contentEncodingTokens(contentEncoding: string | null): string[] {
  if (!contentEncoding) return [];
  return contentEncoding
    .toLowerCase()
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasRealContentEncoding(contentEncoding: string | null): boolean {
  return contentEncodingTokens(contentEncoding).some(
    (token) => token !== "identity",
  );
}

function hasIdentityContentEncoding(contentEncoding: string | null): boolean {
  return contentEncodingTokens(contentEncoding).includes("identity");
}

function wireLengthMatchesDecodedHtml(
  contentLength: number | null,
  htmlBytes: number,
): boolean {
  if (contentLength === null || htmlBytes <= 0) return false;
  return (
    Math.abs(contentLength - htmlBytes) <=
    UNCOMPRESSED_CONTENT_LENGTH_TOLERANCE_BYTES
  );
}

/** True only when the response is known uncompressed. Missing headers are not evidence. */
export function shouldReportUncompressedHtml(page: CrawledPageResult): boolean {
  if (!page.isHtml) return false;
  const encoding = page.responseHeaders.contentEncoding;
  if (hasRealContentEncoding(encoding)) return false;
  if (hasIdentityContentEncoding(encoding)) return true;
  return wireLengthMatchesDecodedHtml(
    page.responseHeaders.contentLength,
    page.htmlBytes,
  );
}
