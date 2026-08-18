import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import Papa from "papaparse";
import { loadLocalEnv, parseArgs } from "../cli-utils";
import {
  ARCHIVE_MANIFEST_FILE,
  CHECKSUM_FILE,
  type ArchiveManifest,
  type EndpointCheckpoint,
  type Logger,
  assertDirectoryEmptyOrMissing,
  atomicWrite,
  consoleLogger,
  fileMatchesRecord,
  normalizeDomain,
  nowIso,
  readOptionalArchiveManifest,
  recordFile,
  redactSecrets,
  resolveWithin,
  slugForPath,
  writeArchiveState,
} from "./shared";

const ANALYTICS_BASE_URL = "https://api.semrush.com/";
const MANAGEMENT_PROJECTS_URL =
  "https://api.semrush.com/management/v1/projects";
const DEFAULT_PAGE_SIZE = 1_000;
const MAX_PAGE_SIZE = 1_000;
const DEFAULT_MAX_PAGES = 1_000;
const DEFAULT_MAX_RETRIES = 3;

export interface ArchiveOptions {
  outputDir: string;
  apiKey?: string;
  domains?: string[];
  databases?: string[];
  pageSize?: number;
  maxPages?: number;
  maxRetries?: number;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  logger?: Logger;
}

interface RequestResult {
  body: string;
  contentType: string;
}

interface RequestOptions {
  apiKey: string;
  label: string;
  url: URL;
  maxRetries: number;
  fetchImpl: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  onAttempt: () => Promise<void>;
}

export async function runArchive(
  options: ArchiveOptions,
): Promise<ArchiveManifest | null> {
  const outputDir = path.resolve(options.outputDir);
  const explicitDomains = uniqueSorted(
    (options.domains ?? [])
      .map(normalizeDomain)
      .filter((domain): domain is string => Boolean(domain)),
  );
  const databases = uniqueSorted(options.databases ?? ["us"]);
  const pageSize = positiveInteger(
    options.pageSize,
    DEFAULT_PAGE_SIZE,
    "pageSize",
  );
  const maxPages = positiveInteger(
    options.maxPages,
    DEFAULT_MAX_PAGES,
    "maxPages",
  );
  const maxRetries = nonnegativeInteger(
    options.maxRetries,
    DEFAULT_MAX_RETRIES,
    "maxRetries",
  );
  const logger = options.logger ?? consoleLogger;
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
      }));

  validateArchiveInputs(outputDir, explicitDomains, databases, pageSize);

  if (options.dryRun) {
    logger.info(`Dry run: no files or network requests will be made.`);
    logger.info(`Archive directory: ${outputDir}`);
    logger.info(`GET management projects`);
    if (explicitDomains.length === 0) {
      logger.info(`Analytics domains: derive from management projects`);
    } else {
      for (const database of databases) {
        for (const domain of explicitDomains) {
          logger.info(`GET domain_ranks for ${domain} (${database})`);
          logger.info(
            `GET paginated domain_organic for ${domain} (${database})`,
          );
        }
      }
    }
    return null;
  }

  const apiKey = options.apiKey ?? process.env.SEMRUSH_API_KEY;
  if (!apiKey) {
    throw new Error("Missing SEMRUSH_API_KEY in the environment.");
  }

  let manifest = await readOptionalArchiveManifest(outputDir);
  if (!manifest) {
    await assertDirectoryEmptyOrMissing(outputDir);
    await mkdir(outputDir, { recursive: true });
    const timestamp = nowIso(now);
    manifest = {
      schemaVersion: 1,
      kind: "semrush-archive",
      createdAt: timestamp,
      updatedAt: timestamp,
      options: {
        databases,
        domains: explicitDomains,
        domainSource:
          explicitDomains.length > 0 ? "explicit" : "management-projects",
        pageSize,
        maxPages,
      },
      endpoints: {},
      files: {},
    };
    await writeArchiveState(outputDir, manifest);
  } else {
    assertCompatibleResume(manifest, {
      explicitDomains,
      databases,
      pageSize,
      maxPages,
    });
    logger.info(`Resuming archive from ${ARCHIVE_MANIFEST_FILE}.`);
    await repairArchiveState(outputDir, manifest);
  }

  try {
    await archiveProjects({
      apiKey,
      fetchImpl,
      logger,
      manifest,
      maxRetries,
      now,
      outputDir,
      sleep,
    });

    if (manifest.options.domainSource === "management-projects") {
      const projectContent = await readFile(
        resolveWithin(outputDir, "raw/management/projects.json"),
        "utf8",
      );
      manifest.options.domains = extractProjectDomains(projectContent);
      manifest.updatedAt = nowIso(now);
      await writeArchiveState(outputDir, manifest);
    }

    for (const database of databases) {
      for (const domain of manifest.options.domains) {
        await archiveDomainRanks({
          apiKey,
          database,
          domain,
          fetchImpl,
          logger,
          manifest,
          maxRetries,
          now,
          outputDir,
          sleep,
        });
        await archiveOrganicKeywords({
          apiKey,
          database,
          domain,
          fetchImpl,
          logger,
          manifest,
          maxRetries,
          now,
          outputDir,
          pageSize,
          maxPages,
          sleep,
        });
      }
    }

    manifest.completedAt = nowIso(now);
    manifest.updatedAt = manifest.completedAt;
    await writeArchiveState(outputDir, manifest);
    logger.info(
      `Archive complete: ${Object.keys(manifest.files).length} checksummed files.`,
    );
    return manifest;
  } catch (error) {
    throw new Error(redactSecrets(error, [apiKey]), { cause: error });
  }
}

async function repairArchiveState(
  outputDir: string,
  manifest: ArchiveManifest,
): Promise<void> {
  try {
    await readFile(path.join(outputDir, CHECKSUM_FILE), "utf8");
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    await writeArchiveState(outputDir, manifest);
  }
}

interface ArchiveContext {
  apiKey: string;
  outputDir: string;
  manifest: ArchiveManifest;
  maxRetries: number;
  fetchImpl: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => Date;
  logger: Logger;
}

async function archiveProjects(context: ArchiveContext): Promise<void> {
  const endpointId = "management.projects";
  const relativePath = "raw/management/projects.json";
  const checkpoint = ensureCheckpoint(context, {
    id: endpointId,
    api: "management",
    type: "projects",
  });
  if (await endpointFilesAreValid(context, checkpoint, [relativePath])) {
    context.logger.info(`Resume: management projects already complete.`);
    return;
  }

  resetCheckpoint(context.manifest, checkpoint, [relativePath], context.now);
  const url = new URL(MANAGEMENT_PROJECTS_URL);
  url.searchParams.set("key", context.apiKey);
  const response = await performCheckpointedRequest(
    context,
    checkpoint,
    url,
    (body) => assertSemrushResponse(body),
  );
  await atomicWrite(
    resolveWithin(context.outputDir, relativePath),
    `${formatJsonIfPossible(response.body)}\n`,
  );
  context.manifest.files[relativePath] = await recordFile(
    context.outputDir,
    relativePath,
    {
      contentType: "application/json",
      endpointId,
      recordCount: countProjects(response.body),
    },
  );
  checkpoint.status = "complete";
  checkpoint.error = undefined;
  checkpoint.updatedAt = nowIso(context.now);
  context.manifest.updatedAt = checkpoint.updatedAt;
  await writeArchiveState(context.outputDir, context.manifest);
}

async function archiveDomainRanks(
  context: ArchiveContext & { domain: string; database: string },
): Promise<void> {
  const endpointId = endpointKey(
    "domain_ranks",
    context.domain,
    context.database,
  );
  const basePath = `raw/analytics/${context.database}/${slugForPath(context.domain)}`;
  const csvPath = `${basePath}/domain-ranks.csv`;
  const nothingFoundPath = `${basePath}/domain-ranks.nothing-found.txt`;
  const checkpoint = ensureCheckpoint(context, {
    id: endpointId,
    api: "analytics",
    type: "domain_ranks",
    domain: context.domain,
    database: context.database,
  });
  const expectedPath = checkpoint.nothingFound ? nothingFoundPath : csvPath;
  if (await endpointFilesAreValid(context, checkpoint, [expectedPath])) {
    context.logger.info(
      `Resume: domain_ranks ${context.domain} (${context.database}) complete.`,
    );
    return;
  }

  resetCheckpoint(
    context.manifest,
    checkpoint,
    [csvPath, nothingFoundPath],
    context.now,
  );
  const url = analyticsUrl(context.apiKey, {
    type: "domain_ranks",
    domain: context.domain,
    database: context.database,
  });
  const response = await performCheckpointedRequest(
    context,
    checkpoint,
    url,
    (body) => assertSemrushResponse(body, { allowNothingFound: true }),
  );
  const nothingFound = isSemrushNothingFound(response.body);
  const relativePath = nothingFound ? nothingFoundPath : csvPath;
  await atomicWrite(
    resolveWithin(context.outputDir, relativePath),
    response.body,
  );
  context.manifest.files[relativePath] = await recordFile(
    context.outputDir,
    relativePath,
    {
      contentType: nothingFound ? "text/plain" : "text/csv",
      endpointId,
      recordCount: nothingFound ? 0 : countCsvRecords(response.body),
    },
  );
  checkpoint.nothingFound = nothingFound || undefined;
  checkpoint.status = "complete";
  checkpoint.error = undefined;
  checkpoint.updatedAt = nowIso(context.now);
  context.manifest.updatedAt = checkpoint.updatedAt;
  await writeArchiveState(context.outputDir, context.manifest);
}

async function archiveOrganicKeywords(
  context: ArchiveContext & {
    domain: string;
    database: string;
    pageSize: number;
    maxPages: number;
  },
): Promise<void> {
  const endpointId = endpointKey(
    "domain_organic",
    context.domain,
    context.database,
  );
  const checkpoint = ensureCheckpoint(context, {
    id: endpointId,
    api: "analytics",
    type: "domain_organic",
    domain: context.domain,
    database: context.database,
    nextOffset: 0,
    pages: [],
  });
  checkpoint.pages ??= [];
  checkpoint.nextOffset ??= checkpoint.pages.length * context.pageSize;

  const validPageCount = await countValidPrefixPages(context, checkpoint);
  if (validPageCount < checkpoint.pages.length) {
    const discarded = checkpoint.pages.slice(validPageCount);
    for (const relativePath of discarded)
      delete context.manifest.files[relativePath];
    checkpoint.pages = checkpoint.pages.slice(0, validPageCount);
    checkpoint.nextOffset = validPageCount * context.pageSize;
    checkpoint.status = "pending";
    checkpoint.nothingFound = undefined;
    checkpoint.updatedAt = nowIso(context.now);
    context.manifest.updatedAt = checkpoint.updatedAt;
    await writeArchiveState(context.outputDir, context.manifest);
  }

  if (checkpoint.status === "complete") {
    context.logger.info(
      `Resume: domain_organic ${context.domain} (${context.database}) complete.`,
    );
    return;
  }

  while ((checkpoint.pages?.length ?? 0) < context.maxPages) {
    const pageNumber: number = (checkpoint.pages?.length ?? 0) + 1;
    const offset: number =
      checkpoint.nextOffset ?? (pageNumber - 1) * context.pageSize;
    const basePath = `raw/analytics/${context.database}/${slugForPath(context.domain)}/domain-organic`;
    const csvPath = `${basePath}/page-${String(pageNumber).padStart(6, "0")}.csv`;
    const url = analyticsUrl(context.apiKey, {
      type: "domain_organic",
      domain: context.domain,
      database: context.database,
      display_limit: String(context.pageSize),
      display_offset: String(offset),
    });
    const response = await performCheckpointedRequest(
      context,
      checkpoint,
      url,
      (body) => assertSemrushResponse(body, { allowNothingFound: true }),
    );
    const nothingFound = isSemrushNothingFound(response.body);
    const relativePath = nothingFound
      ? `${basePath}/nothing-found-offset-${String(offset).padStart(8, "0")}.txt`
      : csvPath;
    const recordCount = nothingFound ? 0 : countCsvRecords(response.body);
    await atomicWrite(
      resolveWithin(context.outputDir, relativePath),
      response.body,
    );
    context.manifest.files[relativePath] = await recordFile(
      context.outputDir,
      relativePath,
      {
        contentType: nothingFound ? "text/plain" : "text/csv",
        endpointId,
        recordCount,
      },
    );
    checkpoint.pages = [...(checkpoint.pages ?? []), relativePath];
    checkpoint.nextOffset = offset + context.pageSize;
    checkpoint.nothingFound = nothingFound || undefined;
    checkpoint.status =
      nothingFound || recordCount < context.pageSize ? "complete" : "running";
    checkpoint.error = undefined;
    checkpoint.updatedAt = nowIso(context.now);
    context.manifest.updatedAt = checkpoint.updatedAt;
    await writeArchiveState(context.outputDir, context.manifest);

    if (checkpoint.status === "complete") return;
  }

  checkpoint.status = "failed";
  checkpoint.error = `Reached maxPages=${context.maxPages} before pagination completed.`;
  checkpoint.updatedAt = nowIso(context.now);
  context.manifest.updatedAt = checkpoint.updatedAt;
  await writeArchiveState(context.outputDir, context.manifest);
  throw new Error(checkpoint.error);
}

function ensureCheckpoint(
  context: Pick<ArchiveContext, "manifest" | "now">,
  seed: Omit<EndpointCheckpoint, "status" | "attempts" | "updatedAt"> &
    Partial<Pick<EndpointCheckpoint, "nextOffset" | "pages">>,
): EndpointCheckpoint {
  const existing = context.manifest.endpoints[seed.id];
  if (existing) return existing;
  const checkpoint: EndpointCheckpoint = {
    ...seed,
    status: "pending",
    attempts: 0,
    updatedAt: nowIso(context.now),
  };
  context.manifest.endpoints[seed.id] = checkpoint;
  return checkpoint;
}

async function endpointFilesAreValid(
  context: ArchiveContext,
  checkpoint: EndpointCheckpoint,
  expectedPaths: string[],
): Promise<boolean> {
  if (checkpoint.status !== "complete") return false;
  for (const relativePath of expectedPaths) {
    const record = context.manifest.files[relativePath];
    if (
      !record ||
      !(await fileMatchesRecord(context.outputDir, relativePath, record))
    ) {
      return false;
    }
  }
  return true;
}

async function countValidPrefixPages(
  context: ArchiveContext,
  checkpoint: EndpointCheckpoint,
): Promise<number> {
  let valid = 0;
  for (const relativePath of checkpoint.pages ?? []) {
    const record = context.manifest.files[relativePath];
    if (
      !record ||
      !(await fileMatchesRecord(context.outputDir, relativePath, record))
    ) {
      break;
    }
    valid += 1;
  }
  return valid;
}

function resetCheckpoint(
  manifest: ArchiveManifest,
  checkpoint: EndpointCheckpoint,
  relativePaths: string[],
  now: () => Date,
): void {
  for (const relativePath of relativePaths) delete manifest.files[relativePath];
  checkpoint.status = "pending";
  checkpoint.error = undefined;
  checkpoint.nothingFound = undefined;
  checkpoint.updatedAt = nowIso(now);
  manifest.completedAt = undefined;
  manifest.updatedAt = checkpoint.updatedAt;
}

async function performCheckpointedRequest(
  context: ArchiveContext,
  checkpoint: EndpointCheckpoint,
  url: URL,
  validate: (body: string) => void,
): Promise<RequestResult> {
  checkpoint.status = "running";
  checkpoint.error = undefined;
  checkpoint.updatedAt = nowIso(context.now);
  context.manifest.completedAt = undefined;
  context.manifest.updatedAt = checkpoint.updatedAt;
  await writeArchiveState(context.outputDir, context.manifest);

  try {
    const response = await requestWithRetry({
      apiKey: context.apiKey,
      label: checkpoint.id,
      url,
      maxRetries: context.maxRetries,
      fetchImpl: context.fetchImpl,
      sleep: context.sleep,
      onAttempt: async () => {
        checkpoint.attempts += 1;
        checkpoint.updatedAt = nowIso(context.now);
        context.manifest.updatedAt = checkpoint.updatedAt;
        await writeArchiveState(context.outputDir, context.manifest);
      },
    });
    validate(response.body);
    return response;
  } catch (error) {
    checkpoint.status = "failed";
    checkpoint.error = redactSecrets(error, [context.apiKey]);
    checkpoint.updatedAt = nowIso(context.now);
    context.manifest.updatedAt = checkpoint.updatedAt;
    await writeArchiveState(context.outputDir, context.manifest);
    throw error;
  }
}

async function requestWithRetry(
  options: RequestOptions,
): Promise<RequestResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    await options.onAttempt();
    try {
      const response = await options.fetchImpl(options.url, {
        method: "GET",
        headers: {
          Accept: "application/json,text/csv,text/plain",
          "User-Agent": "OpenSEO-SEMrush-Archive/1.0",
        },
        redirect: "error",
      });
      const body = await response.text();
      if (!response.ok) {
        const error = new Error(
          `${options.label} returned HTTP ${response.status}: ${redactSecrets(body, [options.apiKey]).slice(0, 300)}`,
        );
        if (
          !isRetryableStatus(response.status) ||
          attempt === options.maxRetries
        ) {
          throw error;
        }
        lastError = error;
      } else {
        return {
          body,
          contentType:
            response.headers.get("content-type") ?? "application/octet-stream",
        };
      }
    } catch (error) {
      lastError = error;
      if (attempt === options.maxRetries || !isRetryableError(error))
        throw error;
    }
    await options.sleep(Math.min(8_000, 500 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function analyticsUrl(apiKey: string, params: Record<string, string>): URL {
  const url = new URL(ANALYTICS_BASE_URL);
  url.searchParams.set("key", apiKey);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return url;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (
    error instanceof Error && /HTTP (?:408|429|5\d\d)/u.test(error.message)
  );
}

function assertSemrushResponse(
  body: string,
  options: { allowNothingFound?: boolean } = {},
): void {
  const trimmed = body.trim();
  if (!/^ERROR\b/iu.test(trimmed)) return;
  if (options.allowNothingFound && /NOTHING FOUND/iu.test(trimmed)) return;
  throw new Error(`SEMrush API error: ${redactSecrets(trimmed).slice(0, 300)}`);
}

function isSemrushNothingFound(body: string): boolean {
  const trimmed = body.trim();
  return /^ERROR\b/iu.test(trimmed) && /NOTHING FOUND/iu.test(trimmed);
}

function countCsvRecords(body: string): number {
  if (!body.trim() || /^ERROR\b/iu.test(body.trim())) return 0;
  const parsed = Papa.parse<string[]>(body, { skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    throw new Error(`Invalid SEMrush CSV: ${parsed.errors[0].message}`);
  }
  return Math.max(0, parsed.data.length - 1);
}

function extractProjectDomains(body: string): string[] {
  const parsed: unknown = JSON.parse(body);
  const domains: string[] = [];
  for (const project of projectObjects(parsed)) {
    for (const key of ["domain", "project_domain", "url", "project_url"]) {
      const domain = normalizeDomain(project[key]);
      if (domain) {
        domains.push(domain);
        break;
      }
    }
  }
  return uniqueSorted(domains);
}

function countProjects(body: string): number {
  try {
    return projectObjects(JSON.parse(body)).length;
  } catch {
    return 0;
  }
}

function projectObjects(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["projects", "data", "items"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatJsonIfPossible(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body.trimEnd();
  }
}

function endpointKey(type: string, domain: string, database: string): string {
  return `analytics.${type}.${database}.${normalizeDomain(domain) ?? domain}`;
}

function validateArchiveInputs(
  outputDir: string,
  domains: string[],
  databases: string[],
  pageSize: number,
): void {
  if (!outputDir)
    throw new Error("An explicit --output directory is required.");
  if (domains.some((domain) => !/^[a-z0-9.-]+$/u.test(domain))) {
    throw new Error("Domains must be hostnames, not paths or arbitrary text.");
  }
  if (
    databases.length === 0 ||
    databases.some((database) => !/^[a-z]{2}$/u.test(database))
  ) {
    throw new Error("Databases must be two-letter SEMrush database codes.");
  }
  if (pageSize > MAX_PAGE_SIZE) {
    throw new Error(
      `pageSize must be at most ${MAX_PAGE_SIZE}; use additional pages instead.`,
    );
  }
}

function assertCompatibleResume(
  manifest: ArchiveManifest,
  options: {
    explicitDomains: string[];
    databases: string[];
    pageSize: number;
    maxPages: number;
  },
): void {
  const expectedDomainSource =
    options.explicitDomains.length > 0 ? "explicit" : "management-projects";
  const mismatch =
    manifest.options.domainSource !== expectedDomainSource ||
    JSON.stringify(manifest.options.databases) !==
      JSON.stringify(options.databases) ||
    manifest.options.pageSize !== options.pageSize ||
    manifest.options.maxPages !== options.maxPages ||
    (expectedDomainSource === "explicit" &&
      JSON.stringify(manifest.options.domains) !==
        JSON.stringify(options.explicitDomains));
  if (mismatch) {
    throw new Error(
      "Archive options do not match the existing manifest; use a different --output directory.",
    );
  }
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return resolved;
}

function nonnegativeInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return resolved;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

async function cli(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args.output;
  if (!outputDir) {
    throw new Error(
      "Usage: pnpm semrush:archive --output <directory> [--domains example.com] [--databases us] [--dry-run]",
    );
  }
  await runArchive({
    outputDir,
    domains: splitList(args.domains),
    databases: splitList(args.databases),
    pageSize: parseOptionalNumber(args["page-size"]),
    maxPages: parseOptionalNumber(args["max-pages"]),
    maxRetries: parseOptionalNumber(args["max-retries"]),
    dryRun: args["dry-run"] === "true",
  });
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

const isMainModule =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  cli().catch((error) => {
    console.error(redactSecrets(error));
    process.exitCode = 1;
  });
}
