import type {
  AiVisibilityAnswer,
  AiVisibilityCitation,
} from "@/server/lib/dataforseo/ai-visibility";

// ---------------------------------------------------------------------------
// Turning a provider answer into ONE structured observation.
//
// The only claims made here are ones the payload actually supports: was the
// brand named, how often, and did the answer cite the tracked domain. There is
// deliberately no composite "visibility score" — providers expose nothing
// comparable to a SERP position, and a synthesized number would read as a
// measurement while being an opinion.
// ---------------------------------------------------------------------------

type AiVisibilityObservationStatus = "completed" | "failed";

type AiVisibilityObservationOutcome =
  | "brand_mentioned"
  | "brand_absent"
  | "unavailable";

export interface ShapedObservation {
  status: AiVisibilityObservationStatus;
  outcome: AiVisibilityObservationOutcome;
  mentionCount: number;
  /** null when no answer was obtained — not the same as "cited nothing". */
  domainCited: boolean | null;
  modelName: string | null;
  errorMessage: string | null;
  citations: Array<AiVisibilityCitation & { isTargetDomain: boolean }>;
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
  citationDomain: string | null,
  targetDomain: string,
): boolean {
  if (!citationDomain) return false;
  const target = targetDomain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  const candidate = citationDomain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (!target || !candidate) return false;
  return candidate === target || candidate.endsWith(`.${target}`);
}

export function shapeObservation(input: {
  brandName: string;
  domain: string;
  answer: AiVisibilityAnswer;
}): ShapedObservation {
  const mentionCount = countBrandMentions(input.answer.text, input.brandName);
  const citations = input.answer.citations.map((citation) => ({
    ...citation,
    isTargetDomain: citationMatchesDomain(citation.domain, input.domain),
  }));

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
    errorMessage: errorMessage.slice(0, 500),
    citations: [],
  };
}

// ---------------------------------------------------------------------------
// Run-level aggregation for the dashboard baseline cards.
// ---------------------------------------------------------------------------

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
