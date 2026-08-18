import { safeHostname, safeHttpUrl } from "@/server/features/ai-search/safeUrl";
import type { AiVisibilityAnswer } from "@/server/lib/dataforseo/ai-visibility";

// ---------------------------------------------------------------------------
// Turning a provider answer into ONE structured observation, and a set of
// observations into the two numbers the dashboard shows.
//
// The only claims made here are ones the payload actually supports: was the
// brand named, how often, and did the answer cite the tracked domain. An
// `unavailable` outcome is reserved for answers we never obtained — a provider
// outage must never be charted as the brand being absent from AI answers.
// ---------------------------------------------------------------------------

const MAX_CITATIONS_PER_OBSERVATION = 25;
const MAX_ERROR_MESSAGE_LENGTH = 500;

export interface ShapedObservation {
  status: "completed" | "failed";
  outcome: "brand_mentioned" | "brand_absent" | "unavailable";
  mentionCount: number;
  /** null when no answer was obtained — not the same as "cited nothing". */
  domainCited: boolean | null;
  modelName: string | null;
  errorMessage: string | null;
  citations: Array<{
    url: string;
    domain: string;
    position: number;
    isTargetDomain: boolean;
  }>;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Count brand occurrences, case-insensitively.
 *
 * Word boundaries are applied only on sides where the brand itself starts or
 * ends with a word character: `\b` next to a symbol (e.g. "C&A", "Yahoo!")
 * never matches, which would silently zero out those brands' mentions.
 */
export function countBrandMentions(text: string, brandName: string): number {
  const brand = brandName.trim();
  if (!brand || !text) return 0;
  const leading = /^\w/.test(brand) ? "\\b" : "";
  const trailing = /\w$/.test(brand) ? "\\b" : "";
  const pattern = new RegExp(
    `${leading}${escapeForRegExp(brand)}${trailing}`,
    "gi",
  );
  return text.match(pattern)?.length ?? 0;
}

/** Domain match including subdomains, mirroring the rank-check comparison. */
function citationMatchesDomain(
  citationDomain: string,
  targetDomain: string,
): boolean {
  const target = targetDomain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!target) return false;
  return citationDomain === target || citationDomain.endsWith(`.${target}`);
}

export function shapeObservation(input: {
  brandName: string;
  domain: string;
  answer: AiVisibilityAnswer;
}): ShapedObservation {
  const mentionCount = countBrandMentions(input.answer.text, input.brandName);

  const seen = new Set<string>();
  const citations: ShapedObservation["citations"] = [];
  for (const reference of input.answer.references) {
    // Provider-emitted URLs are untrusted (a crafted prompt can coax a
    // `javascript:` payload out of a model) and we persist these for later
    // rendering, so filter on scheme before storing.
    const url = safeHttpUrl(reference.url);
    const domain = safeHostname(url);
    if (!url || !domain || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      url,
      domain,
      position: citations.length + 1,
      isTargetDomain: citationMatchesDomain(domain, input.domain),
    });
    if (citations.length >= MAX_CITATIONS_PER_OBSERVATION) break;
  }

  return {
    status: "completed",
    outcome: mentionCount > 0 ? "brand_mentioned" : "brand_absent",
    mentionCount,
    domainCited: citations.some((citation) => citation.isTargetDomain),
    modelName: input.answer.modelName,
    errorMessage: null,
    citations,
  };
}

/**
 * A provider we could not read. `unavailable` exists so a provider outage is
 * never charted as the brand being absent from AI answers.
 */
export function shapeUnavailableObservation(
  errorMessage: string,
): ShapedObservation {
  return {
    status: "failed",
    outcome: "unavailable",
    mentionCount: 0,
    domainCited: null,
    modelName: null,
    errorMessage: errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH),
    citations: [],
  };
}

export interface AiVisibilityRunSummary {
  /** Share of readable observations that named the brand (0–100). */
  visibilityPercent: number | null;
  /** Total brand mentions across the run's readable observations. */
  mentions: number;
  readableObservations: number;
  unavailableObservations: number;
}

/**
 * Aggregate one run. Unavailable observations are excluded from the
 * denominator: including them would report a provider outage as lost
 * visibility, which is the one mistake this whole data model exists to avoid.
 */
export function summarizeAiVisibilityRun(
  observations: readonly {
    status: "completed" | "failed";
    outcome: "brand_mentioned" | "brand_absent" | "unavailable";
    mentionCount: number;
  }[],
): AiVisibilityRunSummary {
  const readable = observations.filter(
    (observation) =>
      observation.status === "completed" &&
      observation.outcome !== "unavailable",
  );
  const mentioned = readable.filter(
    (observation) => observation.outcome === "brand_mentioned",
  ).length;

  return {
    visibilityPercent:
      readable.length > 0 ? (mentioned / readable.length) * 100 : null,
    mentions: readable.reduce(
      (total, observation) => total + observation.mentionCount,
      0,
    ),
    readableObservations: readable.length,
    unavailableObservations: observations.length - readable.length,
  };
}
