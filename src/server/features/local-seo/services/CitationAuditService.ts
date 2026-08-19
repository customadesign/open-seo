import type { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { LocalSeoRepository } from "@/server/features/local-seo/repositories/LocalSeoRepository";
import { findLocalBusinessResult } from "@/server/features/local-seo/services/GeoGridService";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { AppError } from "@/server/lib/errors";
import type {
  LocalBusinessProfile,
  recordCitationAuditSchema,
  runCitationAuditSchema,
} from "@/types/schemas/local-seo";
import { citationClassificationResultSchema } from "@/types/schemas/local-seo";

type CitationEvidence = z.infer<
  typeof recordCitationAuditSchema
>["observations"][number];
type RunCitationAuditInput = z.infer<typeof runCitationAuditSchema>;

const CITATION_PROVIDER_COVERAGE = {
  provider: "dataforseo_business_listings",
  checkedDirectoryKeys: ["google_business"],
  multiDirectoryCoverage: false,
  limitation:
    "This provider run checks Google Business evidence only. Other directories require manual or agent-supplied evidence and are not classified by this run.",
} as const;

const UNIT_MARKERS = new Set([
  "apt",
  "apartment",
  "bldg",
  "building",
  "floor",
  "fl",
  "room",
  "rm",
  "ste",
  "suite",
  "unit",
]);

const STREET_SUFFIXES: Record<string, string> = {
  avenue: "ave",
  boulevard: "blvd",
  circle: "cir",
  court: "ct",
  drive: "dr",
  expressway: "expy",
  highway: "hwy",
  lane: "ln",
  parkway: "pkwy",
  place: "pl",
  road: "rd",
  square: "sq",
  street: "st",
  terrace: "ter",
  trail: "trl",
};

const DIRECTIONS: Record<string, string> = {
  east: "e",
  north: "n",
  northeast: "ne",
  northwest: "nw",
  south: "s",
  southeast: "se",
  southwest: "sw",
  west: "w",
};

function fold(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function alphanumericTokens(value: string) {
  return fold(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizeBusinessName(value: string) {
  const ignored = new Set([
    "co",
    "company",
    "corp",
    "corporation",
    "inc",
    "incorporated",
    "limited",
    "llc",
    "ltd",
  ]);
  return alphanumericTokens(value)
    .filter((token) => !ignored.has(token))
    .join(" ");
}

export function normalizeAddress(value: string) {
  const tokens = alphanumericTokens(
    fold(value)
      .replace(/\bunited states(?: of america)?\b/g, " us ")
      .replace(/\busa\b/g, " us ")
      .replace(/#\s*[a-z0-9-]+/g, " "),
  );
  const normalized: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (UNIT_MARKERS.has(token)) {
      // Unit labels and the immediately following identifier are omitted;
      // directories routinely reorder or omit suite data.
      index += 1;
      continue;
    }
    normalized.push(STREET_SUFFIXES[token] ?? DIRECTIONS[token] ?? token);
  }
  return normalized.join(" ");
}

export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function normalizeWebsite(value: string) {
  try {
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path === "/" ? "" : path}`;
  } catch {
    return fold(value)
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  }
}

function knownComparison(
  observed: string | null | undefined,
  expected: string,
  normalize: (value: string) => string,
) {
  if (observed == null || observed.trim() === "") return null;
  const observedValue = normalize(observed);
  const expectedValue = normalize(expected);
  return observedValue !== "" && expectedValue !== ""
    ? observedValue === expectedValue
    : null;
}

function expectedAddress(profile: LocalBusinessProfile) {
  return [
    profile.addressLine1,
    profile.addressLine2,
    profile.locality,
    profile.region,
    profile.postalCode,
    profile.countryCode,
  ]
    .filter((value): value is string => value != null && value !== "")
    .join(" ");
}

/**
 * Classifications are evidence based: absent observations stay null and a
 * partial row is found_unverified, never silently counted as a confirmed match.
 */
export function classifyCitationEvidence(
  profile: LocalBusinessProfile,
  evidence: CitationEvidence,
) {
  if (evidence.evidenceKind === "blocked") {
    return citationClassificationResultSchema.parse({
      status: "blocked",
      nameMatches: null,
      addressMatches: null,
      phoneMatches: null,
      websiteMatches: null,
    });
  }
  if (evidence.evidenceKind === "not_found") {
    return citationClassificationResultSchema.parse({
      status: "not_found",
      nameMatches: null,
      addressMatches: null,
      phoneMatches: null,
      websiteMatches: null,
    });
  }

  const comparisons = {
    nameMatches: knownComparison(
      evidence.observedName,
      profile.name,
      normalizeBusinessName,
    ),
    addressMatches: knownComparison(
      evidence.observedAddress,
      expectedAddress(profile),
      normalizeAddress,
    ),
    phoneMatches: knownComparison(
      evidence.observedPhone,
      profile.phone,
      normalizePhone,
    ),
    websiteMatches: knownComparison(
      evidence.observedWebsiteUrl,
      profile.websiteUrl,
      normalizeWebsite,
    ),
  };
  const values = Object.values(comparisons);
  const hasMismatch = values.some((value) => value === false);
  const hasUnknown =
    values.some((value) => value === null) || evidence.sourceUrl == null;
  return citationClassificationResultSchema.parse({
    status: hasMismatch
      ? "confirmed_mismatch"
      : hasUnknown
        ? "found_unverified"
        : "confirmed_match",
    ...comparisons,
  });
}

function stringField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function buildGoogleBusinessEvidence(
  profile: LocalBusinessProfile,
  results: Record<string, unknown>[],
): CitationEvidence {
  const match = findLocalBusinessResult(profile, results);
  if (!match) {
    return {
      directoryKey: "google_business",
      evidenceKind: "not_found",
      sourceUrl: null,
      evidenceNote:
        "DataForSEO returned no supported identifier match in the nearby Google Business listing results. Other directories were not checked.",
      errorCode: null,
    };
  }

  const row = match.result;
  const domain = stringField(row, "domain");
  return {
    directoryKey: "google_business",
    evidenceKind: "found",
    // `check_url` is DataForSEO's direct search-engine verification URL;
    // the listing `url` is normally the business website, not evidence origin.
    sourceUrl: stringField(row, "check_url"),
    observedName: stringField(row, "title"),
    observedAddress: stringField(row, "address"),
    observedPhone: stringField(row, "phone"),
    observedWebsiteUrl:
      stringField(row, "url") ?? (domain ? `https://${domain}` : null),
    evidenceNote: `Google Business result matched by ${match.matchedBy}. Other directories were not checked.`,
    errorCode: null,
  };
}

async function createAuditRun(projectId: string, profileId: string) {
  return LocalSeoRepository.createCitationAuditRun({
    id: crypto.randomUUID(),
    projectId,
    profileId,
    status: "running",
  });
}

async function failAuditRun(runId: string, projectId: string, error: unknown) {
  await LocalSeoRepository.updateCitationAuditRun(runId, projectId, {
    status: "failed",
    errorMessage:
      error instanceof Error ? error.message : "Citation audit failed",
    completedAt: new Date().toISOString(),
  });
}

async function completeAuditRun(input: {
  run: Awaited<ReturnType<typeof createAuditRun>>;
  projectId: string;
  profile: LocalBusinessProfile;
  evidence: CitationEvidence[];
}) {
  const observations = input.evidence.map((evidence) => ({
    id: crypto.randomUUID(),
    auditRunId: input.run.id,
    directoryKey: evidence.directoryKey,
    sourceUrl: evidence.sourceUrl ?? null,
    ...classifyCitationEvidence(input.profile, evidence),
    observedName: evidence.observedName ?? null,
    observedAddress: evidence.observedAddress ?? null,
    observedPhone: evidence.observedPhone ?? null,
    observedWebsiteUrl: evidence.observedWebsiteUrl ?? null,
    evidenceNote: evidence.evidenceNote ?? null,
    errorCode: evidence.errorCode ?? null,
    checkedAt: new Date().toISOString(),
  }));
  await LocalSeoRepository.insertCitationObservations(observations);

  const count = (status: (typeof observations)[number]["status"]) =>
    observations.filter((observation) => observation.status === status).length;
  const completed = await LocalSeoRepository.updateCitationAuditRun(
    input.run.id,
    input.projectId,
    {
      status: "completed",
      observationsTotal: observations.length,
      confirmedMatches: count("confirmed_match"),
      confirmedMismatches: count("confirmed_mismatch"),
      foundUnverified: count("found_unverified"),
      notFound: count("not_found"),
      blocked: count("blocked"),
      completedAt: new Date().toISOString(),
    },
  );
  return { run: completed ?? input.run, observations };
}

async function recordAudit(input: z.infer<typeof recordCitationAuditSchema>) {
  const profile = await LocalSeoRepository.getProfileById(
    input.profileId,
    input.projectId,
  );
  if (!profile) {
    throw new AppError("NOT_FOUND", "Local business profile not found");
  }

  const run = await createAuditRun(input.projectId, input.profileId);
  try {
    return await completeAuditRun({
      run,
      projectId: input.projectId,
      profile,
      evidence: input.observations,
    });
  } catch (error) {
    await failAuditRun(run.id, input.projectId, error);
    throw error;
  }
}

async function runProviderAudit(
  input: RunCitationAuditInput & {
    billingCustomer: BillingCustomerContext;
  },
) {
  const profile = input.profileId
    ? await LocalSeoRepository.getProfileById(input.profileId, input.projectId)
    : await LocalSeoRepository.getPrimaryProfile(input.projectId);
  if (!profile) {
    throw new AppError("NOT_FOUND", "Local business profile not found");
  }

  const run = await createAuditRun(input.projectId, profile.id);
  try {
    const client = createDataforseoClient(input.billingCustomer);
    // Business Listings Search is coordinate/radius scoped and exposes no
    // location-code or language selector; the canonical profile coordinates
    // are therefore the documented local-market input for this endpoint.
    const results = await client.business.businessListings({
      title: profile.name,
      locationCoordinate: `${profile.latitude},${profile.longitude},${input.radiusKm}`,
      limit: input.resultLimit,
      creditFeature: "local_seo",
    });
    const completed = await completeAuditRun({
      run,
      projectId: input.projectId,
      profile,
      evidence: [buildGoogleBusinessEvidence(profile, results)],
    });
    return { ...completed, coverage: CITATION_PROVIDER_COVERAGE };
  } catch (error) {
    await failAuditRun(run.id, input.projectId, error);
    throw error;
  }
}

async function getAudits(input: {
  projectId: string;
  profileId?: string;
  auditRunId?: string;
  limit: number;
}) {
  if (input.auditRunId) {
    const run = await LocalSeoRepository.getCitationAuditRun(
      input.auditRunId,
      input.projectId,
    );
    if (!run) throw new AppError("NOT_FOUND", "Citation audit not found");
    return {
      runs: [run],
      observations: await LocalSeoRepository.getCitationObservations(
        run.id,
        input.projectId,
      ),
    };
  }
  if (input.profileId) {
    const profile = await LocalSeoRepository.getProfileById(
      input.profileId,
      input.projectId,
    );
    if (!profile) {
      throw new AppError("NOT_FOUND", "Local business profile not found");
    }
  }
  return {
    runs: await LocalSeoRepository.getCitationAuditRuns(input.projectId, input),
    observations: [],
  };
}

export const CitationAuditService = {
  recordAudit,
  runProviderAudit,
  getAudits,
} as const;
