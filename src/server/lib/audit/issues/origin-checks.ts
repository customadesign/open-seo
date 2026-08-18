/**
 * Origin-level HTTPS/WWW checks. Two extra fetches at most; a failed
 * variant fetch is not evidence and does not fail the audit.
 */
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";
import {
  probeResource,
  probeStatusCode,
} from "@/server/lib/audit/resource-probe";
import { getOrigin } from "@/server/lib/audit/url-utils";

function homepageUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/`;
}

function swapWwwHost(origin: string): string | null {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    url.hostname = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function httpHomepageUrl(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return null;
    url.protocol = "http:";
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isRedirectStatus(statusCode: number | null): boolean {
  return statusCode !== null && statusCode >= 300 && statusCode < 400;
}

export async function runOriginVariantChecks(input: {
  startUrl: string;
}): Promise<DetectedIssue[]> {
  const issues: DetectedIssue[] = [];
  const origin = getOrigin(input.startUrl);
  const primary = homepageUrl(origin);
  const wwwSwap = swapWwwHost(origin);
  const httpHome = httpHomepageUrl(origin);

  if (wwwSwap) {
    const [primaryProbe, variantProbe] = await Promise.all([
      probeResource(primary),
      probeResource(wwwSwap),
    ]);
    const primaryStatus = probeStatusCode(primaryProbe);
    const variantStatus = probeStatusCode(variantProbe);
    if (primaryStatus === 200 && variantStatus === 200) {
      issues.push({
        issueType: "www-resolve-issue",
        pageId: null,
        pageUrl: primary,
        details: { otherUrl: wwwSwap },
      });
    }
  }

  if (httpHome) {
    const httpProbe = await probeResource(httpHome);
    // Unreachable HTTP is not evidence — many hosts only listen on 443.
    if (httpProbe.kind === "ok" || httpProbe.kind === "inspect") {
      const status = probeStatusCode(httpProbe);
      if (!isRedirectStatus(status)) {
        issues.push({
          issueType: "http-homepage-not-secure",
          pageId: null,
          pageUrl: httpHome,
          details: { statusCode: status, httpsHomepage: primary },
        });
      }
    }
  }

  return issues;
}
