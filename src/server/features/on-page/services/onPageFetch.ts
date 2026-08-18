import { analyzeHtml } from "@/server/lib/audit/page-analyzer";
import { normalizeUrl } from "@/server/lib/audit/url-utils";
import { fleschReadingEase, type ParsedPageSnapshot } from "./onPageIdeas";

const FETCH_USER_AGENT = "OpenSEO-Audit/1.0";
const MAX_HTML_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;

async function readTextUpTo(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    received += value.byteLength;
  }
  await reader.cancel();
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    const slice =
      chunk.byteLength > maxBytes - offset
        ? chunk.subarray(0, maxBytes - offset)
        : chunk;
    bytes.set(slice, offset);
    offset += slice.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Fetch one URL for content comparison. Follows a short redirect chain so
 * competitor landing pages resolve, then reuses the audit HTML analyzer.
 */
export async function fetchParsedPage(
  url: string,
): Promise<ParsedPageSnapshot | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetch(current, {
        headers: {
          "User-Agent": FETCH_USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      const next = location ? normalizeUrl(location, current) : null;
      if (!next) return null;
      current = next;
      continue;
    }

    if (response.status >= 400) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;
    const html = await readTextUpTo(response, MAX_HTML_BYTES);
    if (!html) return null;
    const analysis = analyzeHtml(html, current, response.status, 0);
    return {
      url: current,
      title: analysis.title,
      h1s: analysis.h1s,
      bodyText: analysis.bodyText,
      wordCount: analysis.wordCount,
      fleschReadingEase: fleschReadingEase(analysis.bodyText),
    };
  }
  return null;
}
