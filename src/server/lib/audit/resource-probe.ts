/**
 * Bounded extra-resource checker for site-audit finalize.
 *
 * Dedupes URLs, caps total probes per run, uses HEAD with a GET fallback,
 * and never throws. A slow or hostile host is recorded as a failed probe
 * and cannot stall the crawl.
 */
import { isCrawlableUrl } from "@/server/lib/audit/url-policy";
import {
  MAX_RESOURCE_PROBES_PER_RUN,
  RESOURCE_PROBE_CONCURRENCY,
  RESOURCE_PROBE_MAX_BODY_BYTES,
  RESOURCE_PROBE_TIMEOUT_MS,
} from "@/server/lib/audit/issues/thresholds";

const PROBE_USER_AGENT = "OpenSEO-Audit/1.0";

export interface ResourceProbeHeaders {
  contentEncoding: string | null;
  cacheControl: string | null;
  expires: string | null;
  contentType: string | null;
  contentLength: number | null;
  strictTransportSecurity: string | null;
}

export type ResourceProbeStatus =
  | { kind: "ok"; statusCode: number; headers: ResourceProbeHeaders }
  | {
      kind: "inspect";
      statusCode: number;
      headers: ResourceProbeHeaders;
      body: string;
      bodyBytes: number;
    }
  | { kind: "skipped"; reason: "cap" | "unsafe" | "invalid" }
  | { kind: "unreachable"; reason: "timeout" | "network" };

export interface ResourceProbeBudget {
  remaining: number;
  attempted: number;
  skippedByCap: number;
}

export function createResourceProbeBudget(
  cap = MAX_RESOURCE_PROBES_PER_RUN,
): ResourceProbeBudget {
  return { remaining: cap, attempted: 0, skippedByCap: 0 };
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readProbeHeaders(headers: Headers): ResourceProbeHeaders {
  return {
    contentEncoding: headers.get("content-encoding"),
    cacheControl: headers.get("cache-control"),
    expires: headers.get("expires"),
    contentType: headers.get("content-type"),
    contentLength: parseContentLength(headers.get("content-length")),
    strictTransportSecurity: headers.get("strict-transport-security"),
  };
}

async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bodyBytes: number }> {
  if (!response.body) return { text: "", bodyBytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bodyBytes = 0;
  try {
    while (bodyBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - bodyBytes;
      const chunk =
        value.byteLength > remaining ? value.subarray(0, remaining) : value;
      bodyBytes += chunk.byteLength;
      parts.push(decoder.decode(chunk, { stream: true }));
      if (bodyBytes >= maxBytes) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // A mid-stream failure still yields whatever we already decoded.
  } finally {
    reader.releaseLock();
  }
  parts.push(decoder.decode());
  return { text: parts.join(""), bodyBytes };
}

function classifyProbeError(error: unknown): "timeout" | "network" {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|aborted/i.test(message)) return "timeout";
  return "network";
}

async function fetchOnce(
  url: string,
  method: "HEAD" | "GET",
  readBody: boolean,
): Promise<ResourceProbeStatus> {
  const response = await fetch(url, {
    method,
    headers: {
      "User-Agent": PROBE_USER_AGENT,
      Accept: "*/*",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(RESOURCE_PROBE_TIMEOUT_MS),
  });
  const headers = readProbeHeaders(response.headers);
  if (!readBody) {
    return { kind: "ok", statusCode: response.status, headers };
  }
  const { text, bodyBytes } = await readBodyCapped(
    response,
    RESOURCE_PROBE_MAX_BODY_BYTES,
  );
  return {
    kind: "inspect",
    statusCode: response.status,
    headers,
    body: text,
    bodyBytes,
  };
}

/**
 * Probe one URL. HEAD first; GET if HEAD is rejected or we need the body.
 * Never throws.
 */
export async function probeResource(
  url: string,
  options: { inspect?: boolean } = {},
): Promise<ResourceProbeStatus> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "skipped", reason: "invalid" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { kind: "skipped", reason: "invalid" };
  }
  if (!isCrawlableUrl(url)) {
    return { kind: "skipped", reason: "unsafe" };
  }

  const inspect = options.inspect === true;
  try {
    if (!inspect) {
      try {
        const head = await fetchOnce(url, "HEAD", false);
        if (head.kind === "ok" && head.statusCode !== 405) {
          return head;
        }
      } catch {
        // HEAD failed; fall through to GET.
      }
    }
    return await fetchOnce(url, "GET", inspect);
  } catch (error) {
    return { kind: "unreachable", reason: classifyProbeError(error) };
  }
}

export async function probeResources(
  urls: string[],
  budget: ResourceProbeBudget,
  options: { inspect?: boolean } = {},
): Promise<Map<string, ResourceProbeStatus>> {
  const results = new Map<string, ResourceProbeStatus>();
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }

  const queue = [...unique];
  const workers = Array.from(
    { length: Math.min(RESOURCE_PROBE_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length > 0) {
        const url = queue.shift();
        if (!url) break;
        if (budget.remaining <= 0) {
          budget.skippedByCap += 1;
          results.set(url, { kind: "skipped", reason: "cap" });
          continue;
        }
        budget.remaining -= 1;
        budget.attempted += 1;
        results.set(url, await probeResource(url, options));
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function probeStatusCode(
  result: ResourceProbeStatus | undefined,
): number | null {
  if (!result) return null;
  if (result.kind === "ok" || result.kind === "inspect")
    return result.statusCode;
  return null;
}

export function isBrokenProbeStatus(statusCode: number | null): boolean {
  return statusCode !== null && statusCode >= 400;
}
