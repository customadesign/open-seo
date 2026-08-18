import { isLighthouseFailure } from "@/client/features/audit/results/AuditResultsTableFilterLogic";

type LighthouseFailureKind =
  | "billing"
  | "authentication"
  | "rate-limit"
  | "timeout"
  | "upstream"
  | "missing-scores"
  | "unknown";

interface LighthouseFailureGuidance {
  kind: LighthouseFailureKind;
  title: string;
  explanation: string;
  howToFix: string;
}

interface LighthouseFailedTest {
  id: string;
  pageUrl: string | null;
  strategy: "mobile" | "desktop";
}

export interface LighthouseFailureRow {
  id: string;
  pageId: string;
  strategy: "mobile" | "desktop";
  errorMessage: string | null;
  performanceScore: number | null;
  accessibilityScore: number | null;
  bestPracticesScore: number | null;
  seoScore: number | null;
}

export interface LighthousePageReference {
  id: string;
  url: string;
}

interface LighthouseFailureGroup {
  guidance: LighthouseFailureGuidance;
  technicalDetail: string;
  tests: LighthouseFailedTest[];
}

const GUIDANCE: Record<LighthouseFailureKind, LighthouseFailureGuidance> = {
  billing: {
    kind: "billing",
    title: "DataForSEO billing blocked Lighthouse",
    explanation:
      "The provider rejected these tests because the connected DataForSEO account has a billing or balance problem.",
    howToFix:
      "Add credit or resolve the billing issue in DataForSEO, then run the site audit again.",
  },
  authentication: {
    kind: "authentication",
    title: "DataForSEO rejected the API credentials",
    explanation:
      "OpenSEO could not authenticate the connected DataForSEO account, so Lighthouse never started.",
    howToFix:
      "Check DATAFORSEO_API_KEY, confirm it contains the base64-encoded DataForSEO login and API password, restart OpenSEO after changing it, then run the audit again.",
  },
  "rate-limit": {
    kind: "rate-limit",
    title: "DataForSEO rate-limited the tests",
    explanation:
      "The provider received too many requests in a short period and did not complete these Lighthouse tests.",
    howToFix:
      "Wait for the rate-limit window to clear, then run the audit again. If it keeps happening, reduce concurrent audit activity.",
  },
  timeout: {
    kind: "timeout",
    title: "The Lighthouse request timed out",
    explanation:
      "The provider did not finish before the request deadline. A slow page, bot protection, or a temporary network problem can cause this.",
    howToFix:
      "Retry the audit. If the same URLs keep timing out, check their response time and allow the audit traffic through the site's firewall or bot protection.",
  },
  upstream: {
    kind: "upstream",
    title: "The Lighthouse provider was unavailable",
    explanation:
      "DataForSEO returned a server-side failure before it could supply Lighthouse scores.",
    howToFix:
      "Run the audit again after the provider recovers. If the failure repeats, check OpenSEO's server logs and DataForSEO's service status.",
  },
  "missing-scores": {
    kind: "missing-scores",
    title: "Lighthouse returned no category scores",
    explanation:
      "The test completed without usable performance, accessibility, best-practices, or SEO scores.",
    howToFix:
      "Run the audit again. If the same page still has no scores, check whether it redirects, blocks automated browsers, or fails while loading.",
  },
  unknown: {
    kind: "unknown",
    title: "Lighthouse could not complete the test",
    explanation:
      "OpenSEO saved the provider error, but it does not match a common billing, authentication, rate-limit, timeout, or availability failure.",
    howToFix:
      "Review the technical detail below, check the OpenSEO server logs, and run the audit again after correcting the reported problem.",
  },
};

export function getLighthouseFailureGuidance(
  errorMessage: string | null,
): LighthouseFailureGuidance {
  if (!errorMessage?.trim()) return GUIDANCE["missing-scores"];

  const message = errorMessage.toLowerCase();
  if (
    /\bhttp\s*402\b|\bstatus\s*402\b|\b402(?:00|10)\b/.test(message) ||
    /insufficient funds|balance is too low|payment required|billing|recharged/.test(
      message,
    )
  ) {
    return GUIDANCE.billing;
  }
  if (
    /\bhttp\s*401\b|\bstatus\s*401\b|unauthori[sz]ed|authentication|api key/.test(
      message,
    )
  ) {
    return GUIDANCE.authentication;
  }
  if (
    /\bhttp\s*429\b|\bstatus\s*429\b|rate.?limit|too many requests/.test(
      message,
    )
  ) {
    return GUIDANCE["rate-limit"];
  }
  if (/timed?\s*out|timeout|deadline|aborted?/.test(message)) {
    return GUIDANCE.timeout;
  }
  if (
    /\bhttp\s*5\d\d\b|\bstatus\s*5\d\d\b|temporarily unavailable|upstream/.test(
      message,
    )
  ) {
    return GUIDANCE.upstream;
  }
  if (/no category scores|missing scores/.test(message)) {
    return GUIDANCE["missing-scores"];
  }
  return GUIDANCE.unknown;
}

export function groupLighthouseFailures(
  lighthouse: readonly LighthouseFailureRow[],
  pages: readonly LighthousePageReference[],
): LighthouseFailureGroup[] {
  const pageUrlById = new Map(pages.map((page) => [page.id, page.url]));
  const groups = new Map<string, LighthouseFailureGroup>();

  for (const result of lighthouse) {
    if (!isLighthouseFailure(result)) continue;

    const technicalDetail =
      result.errorMessage?.trim() || "Lighthouse returned no category scores";
    const guidance = getLighthouseFailureGuidance(result.errorMessage);
    const key = `${guidance.kind}\u0000${technicalDetail}`;
    let group = groups.get(key);
    if (!group) {
      group = { guidance, technicalDetail, tests: [] };
      groups.set(key, group);
    }
    group.tests.push({
      id: result.id,
      pageUrl: pageUrlById.get(result.pageId) ?? null,
      strategy: result.strategy,
    });
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    tests: group.tests.toSorted(
      (left, right) =>
        (left.pageUrl ?? "").localeCompare(right.pageUrl ?? "") ||
        left.strategy.localeCompare(right.strategy),
    ),
  }));
}
