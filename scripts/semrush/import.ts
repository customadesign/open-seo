import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import Papa from "papaparse";
import { parseArgs } from "../cli-utils";
import {
  ARCHIVE_MANIFEST_FILE,
  CHECKSUM_FILE,
  type ArchiveManifest,
  type ImportManifest,
  type Logger,
  assertDirectoryEmptyOrMissing,
  atomicWrite,
  consoleLogger,
  fileMatchesRecord,
  loadArchiveManifest,
  normalizeDomain,
  nowIso,
  readOptionalImportManifest,
  redactSecrets,
  resolveWithin,
  sha256,
  sha256File,
  verifyChecksums,
  writeImportState,
} from "./shared";

export interface ImportOptions {
  inputDir: string;
  outputDir: string;
  dryRun?: boolean;
  allowIncompleteSource?: boolean;
  now?: () => Date;
  logger?: Logger;
}

interface NormalizedProject {
  source: "semrush-management";
  sourceProjectId: string;
  name: string;
  domain: string | null;
  sourceFile: string;
}

interface NormalizedDomainSnapshot {
  source: "semrush-analytics";
  sourceKey: string;
  domain: string;
  database: string;
  date: string | null;
  rank: number | null;
  organicKeywords: number | null;
  organicTraffic: number | null;
  organicCost: number | null;
  adwordsKeywords: number | null;
  adwordsTraffic: number | null;
  adwordsCost: number | null;
  sourceFile: string;
}

interface NormalizedOrganicKeyword {
  source: "semrush-analytics";
  sourceKey: string;
  domain: string;
  database: string;
  keyword: string;
  position: number | null;
  previousPosition: number | null;
  searchVolume: number | null;
  cpc: number | null;
  url: string | null;
  trafficPercent: number | null;
  trafficCostPercent: number | null;
  competition: number | null;
  results: number | null;
  trends: string | null;
  timestamp: string | null;
  sourceFile: string;
}

interface MalformedRow {
  file: string;
  row: number;
  reason: string;
}

interface ReconciliationSummary {
  schemaVersion: 1;
  sourceArchiveCreatedAt: string;
  sourceArchiveCompletedAt: string | null;
  counts: {
    sourceProjects: number;
    normalizedProjects: number;
    sourceDomainSnapshotRows: number;
    normalizedDomainSnapshots: number;
    sourceOrganicRows: number;
    normalizedOrganicKeywords: number;
    malformedRows: number;
    exactDuplicatesRemoved: number;
    conflictingRows: number;
    matchedDomains: number;
    analyticsDomainsWithoutProject: number;
    projectsWithoutAnalytics: number;
    ignoredArchiveFiles: number;
    incompleteEndpoints: number;
    emptyAnalyticsEndpoints: number;
  };
  incompleteEndpoints: Array<{
    id: string;
    status: ArchiveManifest["endpoints"][string]["status"];
    error?: string;
  }>;
  emptyAnalyticsEndpoints: string[];
  duplicateProjectDomains: Array<{
    domain: string;
    sourceProjectIds: string[];
  }>;
  analyticsDomainsWithoutProject: string[];
  projectsWithoutAnalytics: Array<{
    sourceProjectId: string;
    name: string;
    domain: string;
  }>;
  conflicts: Array<{
    entity: "domain-snapshot" | "organic-keyword";
    sourceKey: string;
    keptSourceFile: string;
    conflictingSourceFile: string;
  }>;
  malformed: MalformedRow[];
  notes: string[];
}

interface ParsedBundle {
  projects: NormalizedProject[];
  snapshots: NormalizedDomainSnapshot[];
  organicKeywords: NormalizedOrganicKeyword[];
  reconciliation: ReconciliationSummary;
}

interface CsvRow {
  row: Record<string, string>;
  rowNumber: number;
}

export async function runImport(
  options: ImportOptions,
): Promise<ImportManifest | null> {
  if (!options.inputDir)
    throw new Error("An explicit --input directory is required.");
  if (!options.outputDir)
    throw new Error("An explicit --output directory is required.");

  const inputDir = path.resolve(options.inputDir);
  const outputDir = path.resolve(options.outputDir);
  if (inputDir === outputDir) {
    throw new Error("--input and --output must be different directories.");
  }

  const logger = options.logger ?? consoleLogger;
  const now = options.now ?? (() => new Date());
  const archive = await loadArchiveManifest(inputDir);
  await verifyChecksums(inputDir, archive.files);
  const incompleteEndpoints = Object.values(archive.endpoints).filter(
    (endpoint) => endpoint.status !== "complete",
  );
  if (
    (archive.completedAt == null || incompleteEndpoints.length > 0) &&
    !options.allowIncompleteSource
  ) {
    throw new Error(
      `Source archive is incomplete (${incompleteEndpoints.length} non-complete endpoints). Resume the archive or pass --allow-incomplete-source for a clearly marked diagnostic bundle.`,
    );
  }
  if (archive.completedAt == null || incompleteEndpoints.length > 0) {
    logger.warn(
      `Continuing with an incomplete source archive: completedAt=${archive.completedAt ?? "missing"}; endpoints=${incompleteEndpoints.map((endpoint) => `${endpoint.id}:${endpoint.status}`).join(", ") || "none"}.`,
    );
  }
  const sourceManifestSha256 = await sha256File(
    path.join(inputDir, ARCHIVE_MANIFEST_FILE),
  );
  const bundle = await parseArchive(inputDir, archive);

  if (options.dryRun) {
    logger.info(
      "Dry run: source checksums verified; no files will be written.",
    );
    logger.info(
      `Would write ${bundle.projects.length} projects, ${bundle.snapshots.length} domain snapshots, and ${bundle.organicKeywords.length} organic keyword rows.`,
    );
    logger.info(
      `Reconciliation: ${bundle.reconciliation.counts.analyticsDomainsWithoutProject} analytics domains without a project; ${bundle.reconciliation.counts.projectsWithoutAnalytics} projects without analytics.`,
    );
    return null;
  }

  let manifest = await readOptionalImportManifest(outputDir);
  if (!manifest) {
    await assertDirectoryEmptyOrMissing(outputDir);
    const timestamp = nowIso(now);
    manifest = {
      schemaVersion: 1,
      kind: "semrush-import-bundle",
      createdAt: timestamp,
      updatedAt: timestamp,
      sourceManifestSha256,
      stages: {
        projects: { status: "pending", updatedAt: timestamp },
        analytics: { status: "pending", updatedAt: timestamp },
        reconciliation: { status: "pending", updatedAt: timestamp },
      },
      files: {},
    };
    await writeImportState(outputDir, manifest);
  } else {
    if (manifest.sourceManifestSha256 !== sourceManifestSha256) {
      throw new Error(
        "Source archive manifest changed; use a new --output directory for this import.",
      );
    }
    logger.info("Resuming normalized import bundle.");
    await repairImportState(outputDir, manifest);
  }

  await writeStage({
    outputDir,
    manifest,
    stage: "projects",
    now,
    logger,
    files: [
      {
        relativePath: "normalized/projects.ndjson",
        content: renderNdjson(bundle.projects),
        contentType: "application/x-ndjson",
        recordCount: bundle.projects.length,
      },
    ],
  });
  await writeStage({
    outputDir,
    manifest,
    stage: "analytics",
    now,
    logger,
    files: [
      {
        relativePath: "normalized/domain-snapshots.ndjson",
        content: renderNdjson(bundle.snapshots),
        contentType: "application/x-ndjson",
        recordCount: bundle.snapshots.length,
      },
      {
        relativePath: "normalized/organic-keywords.ndjson",
        content: renderNdjson(bundle.organicKeywords),
        contentType: "application/x-ndjson",
        recordCount: bundle.organicKeywords.length,
      },
    ],
  });
  await writeStage({
    outputDir,
    manifest,
    stage: "reconciliation",
    now,
    logger,
    files: [
      {
        relativePath: "reconciliation.json",
        content: `${JSON.stringify(bundle.reconciliation, null, 2)}\n`,
        contentType: "application/json",
        recordCount: 1,
      },
    ],
  });

  manifest.completedAt = nowIso(now);
  manifest.updatedAt = manifest.completedAt;
  await writeImportState(outputDir, manifest);
  logger.info(
    "Import bundle complete; no application database writes were made.",
  );
  return manifest;
}

async function repairImportState(
  outputDir: string,
  manifest: ImportManifest,
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
    await writeImportState(outputDir, manifest);
  }
}

async function parseArchive(
  inputDir: string,
  archive: ArchiveManifest,
): Promise<ParsedBundle> {
  const projects: NormalizedProject[] = [];
  const snapshots: NormalizedDomainSnapshot[] = [];
  const organicKeywords: NormalizedOrganicKeyword[] = [];
  const malformed: MalformedRow[] = [];
  const conflicts: ReconciliationSummary["conflicts"] = [];
  const snapshotByKey = new Map<string, NormalizedDomainSnapshot>();
  const organicByKey = new Map<string, NormalizedOrganicKeyword>();
  let sourceProjects = 0;
  let sourceDomainSnapshotRows = 0;
  let sourceOrganicRows = 0;
  let exactDuplicatesRemoved = 0;
  let ignoredArchiveFiles = 0;
  const emptyAnalyticsEndpoints = new Set<string>();

  for (const [relativePath, file] of Object.entries(archive.files).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const endpoint = archive.endpoints[file.endpointId];
    if (!endpoint) {
      ignoredArchiveFiles += 1;
      continue;
    }
    if (endpoint.api === "analytics" && endpoint.nothingFound) {
      emptyAnalyticsEndpoints.add(endpoint.id);
      if (file.contentType === "text/plain") continue;
    }
    const content = await readFile(
      resolveWithin(inputDir, relativePath),
      "utf8",
    );

    if (endpoint.api === "management" && endpoint.type === "projects") {
      const rawProjects = projectObjects(JSON.parse(content));
      sourceProjects += rawProjects.length;
      for (const [index, rawProject] of rawProjects.entries()) {
        const normalized = normalizeProject(rawProject, relativePath, index);
        if (normalized) projects.push(normalized);
        else {
          malformed.push({
            file: relativePath,
            row: index + 1,
            reason: "Project is missing both an id and a name.",
          });
        }
      }
      continue;
    }

    if (endpoint.api !== "analytics") {
      ignoredArchiveFiles += 1;
      continue;
    }

    if (endpoint.type === "domain_ranks") {
      const rows = parseCsv(content, relativePath, malformed);
      sourceDomainSnapshotRows += rows.length;
      for (const { row, rowNumber } of rows) {
        const normalized = normalizeSnapshot(row, endpoint, relativePath);
        if (!normalized) {
          malformed.push({
            file: relativePath,
            row: rowNumber,
            reason: "Domain rank row is missing a valid domain.",
          });
          continue;
        }
        const duplicate = snapshotByKey.get(normalized.sourceKey);
        if (!duplicate) {
          snapshotByKey.set(normalized.sourceKey, normalized);
          snapshots.push(normalized);
        } else if (sameEntity(duplicate, normalized)) {
          exactDuplicatesRemoved += 1;
        } else {
          conflicts.push({
            entity: "domain-snapshot",
            sourceKey: normalized.sourceKey,
            keptSourceFile: duplicate.sourceFile,
            conflictingSourceFile: normalized.sourceFile,
          });
        }
      }
      continue;
    }

    if (endpoint.type === "domain_organic") {
      const rows = parseCsv(content, relativePath, malformed);
      sourceOrganicRows += rows.length;
      for (const { row, rowNumber } of rows) {
        const normalized = normalizeOrganicKeyword(row, endpoint, relativePath);
        if (!normalized) {
          malformed.push({
            file: relativePath,
            row: rowNumber,
            reason: "Organic row is missing a valid domain or keyword.",
          });
          continue;
        }
        const duplicate = organicByKey.get(normalized.sourceKey);
        if (!duplicate) {
          organicByKey.set(normalized.sourceKey, normalized);
          organicKeywords.push(normalized);
        } else if (sameEntity(duplicate, normalized)) {
          exactDuplicatesRemoved += 1;
        } else {
          conflicts.push({
            entity: "organic-keyword",
            sourceKey: normalized.sourceKey,
            keptSourceFile: duplicate.sourceFile,
            conflictingSourceFile: normalized.sourceFile,
          });
        }
      }
      continue;
    }

    ignoredArchiveFiles += 1;
  }

  projects.sort((a, b) => a.sourceProjectId.localeCompare(b.sourceProjectId));
  snapshots.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
  organicKeywords.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));

  const projectDomains = groupProjectDomains(projects);
  const analyticsDomains = new Set([
    ...snapshots.map((row) => row.domain),
    ...organicKeywords.map((row) => row.domain),
  ]);
  const analyticsDomainsWithoutProject = [...analyticsDomains]
    .filter((domain) => !projectDomains.has(domain))
    .sort();
  const projectsWithoutAnalytics = projects
    .filter(
      (project): project is NormalizedProject & { domain: string } =>
        project.domain != null && !analyticsDomains.has(project.domain),
    )
    .map(({ sourceProjectId, name, domain }) => ({
      sourceProjectId,
      name,
      domain,
    }));
  const duplicateProjectDomains = [...projectDomains.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([domain, values]) => ({
      domain,
      sourceProjectIds: values.map((project) => project.sourceProjectId).sort(),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
  const matchedDomains = [...analyticsDomains].filter((domain) =>
    projectDomains.has(domain),
  ).length;

  return {
    projects,
    snapshots,
    organicKeywords,
    reconciliation: {
      schemaVersion: 1,
      sourceArchiveCreatedAt: archive.createdAt,
      sourceArchiveCompletedAt: archive.completedAt ?? null,
      counts: {
        sourceProjects,
        normalizedProjects: projects.length,
        sourceDomainSnapshotRows,
        normalizedDomainSnapshots: snapshots.length,
        sourceOrganicRows,
        normalizedOrganicKeywords: organicKeywords.length,
        malformedRows: malformed.length,
        exactDuplicatesRemoved,
        conflictingRows: conflicts.length,
        matchedDomains,
        analyticsDomainsWithoutProject: analyticsDomainsWithoutProject.length,
        projectsWithoutAnalytics: projectsWithoutAnalytics.length,
        ignoredArchiveFiles,
        incompleteEndpoints: Object.values(archive.endpoints).filter(
          (endpoint) => endpoint.status !== "complete",
        ).length,
        emptyAnalyticsEndpoints: emptyAnalyticsEndpoints.size,
      },
      incompleteEndpoints: Object.values(archive.endpoints)
        .filter((endpoint) => endpoint.status !== "complete")
        .map((endpoint) => ({
          id: endpoint.id,
          status: endpoint.status,
          ...(endpoint.error ? { error: endpoint.error } : {}),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      emptyAnalyticsEndpoints: [...emptyAnalyticsEndpoints].sort(),
      duplicateProjectDomains,
      analyticsDomainsWithoutProject,
      projectsWithoutAnalytics,
      conflicts,
      malformed,
      notes: [
        "This v1 bundle is staging data only; it does not write to an OpenSEO database.",
        "Domain matches are normalized by lowercase hostname with a leading www removed.",
        "Conflicting duplicate rows keep the first row in deterministic source-file order.",
        "SEMrush NOTHING FOUND responses are listed separately from successful zero-row CSV responses.",
      ],
    },
  };
}

function normalizeProject(
  project: Record<string, unknown>,
  sourceFile: string,
  index: number,
): NormalizedProject | null {
  const sourceProjectId = firstString(project, [
    "project_id",
    "projectId",
    "id",
  ]);
  const name = firstString(project, ["project_name", "projectName", "name"]);
  if (!sourceProjectId && !name) return null;
  const domain = normalizeDomain(
    firstUnknown(project, [
      "domain",
      "project_domain",
      "projectDomain",
      "url",
      "project_url",
    ]),
  );
  return {
    source: "semrush-management",
    sourceProjectId:
      sourceProjectId ?? `row-${index + 1}-${sha256(name ?? "").slice(0, 12)}`,
    name: name ?? domain ?? `SEMrush project ${index + 1}`,
    domain,
    sourceFile,
  };
}

function normalizeSnapshot(
  row: Record<string, string>,
  endpoint: ArchiveManifest["endpoints"][string],
  sourceFile: string,
): NormalizedDomainSnapshot | null {
  const domain = normalizeDomain(
    readCell(row, ["domain", "dn"]) ?? endpoint.domain,
  );
  if (!domain) return null;
  const database =
    readCell(row, ["database", "db"])?.toLowerCase() ??
    endpoint.database ??
    "unknown";
  const date = nullableString(readCell(row, ["date", "dt"]));
  return {
    source: "semrush-analytics",
    sourceKey: `${domain}|${database}|${date ?? "latest"}`,
    domain,
    database,
    date,
    rank: nullableNumber(readCell(row, ["rank", "rk"])),
    organicKeywords: nullableNumber(readCell(row, ["organickeywords", "or"])),
    organicTraffic: nullableNumber(readCell(row, ["organictraffic", "ot"])),
    organicCost: nullableNumber(readCell(row, ["organiccost", "oc"])),
    adwordsKeywords: nullableNumber(readCell(row, ["adwordskeywords", "ad"])),
    adwordsTraffic: nullableNumber(readCell(row, ["adwordstraffic", "at"])),
    adwordsCost: nullableNumber(readCell(row, ["adwordscost", "ac"])),
    sourceFile,
  };
}

function normalizeOrganicKeyword(
  row: Record<string, string>,
  endpoint: ArchiveManifest["endpoints"][string],
  sourceFile: string,
): NormalizedOrganicKeyword | null {
  const domain = normalizeDomain(
    readCell(row, ["domain", "dn"]) ?? endpoint.domain,
  );
  const keyword = nullableString(readCell(row, ["keyword", "ph"]));
  if (!domain || !keyword) return null;
  const database =
    readCell(row, ["database", "db"])?.toLowerCase() ??
    endpoint.database ??
    "unknown";
  const url = nullableString(readCell(row, ["url", "ur"]));
  const sourceKey = `${domain}|${database}|${keyword.toLowerCase()}|${url ?? ""}`;
  return {
    source: "semrush-analytics",
    sourceKey,
    domain,
    database,
    keyword,
    position: nullableNumber(readCell(row, ["position", "po"])),
    previousPosition: nullableNumber(
      readCell(row, ["previousposition", "previous", "pp"]),
    ),
    searchVolume: nullableNumber(readCell(row, ["searchvolume", "nq"])),
    cpc: nullableNumber(readCell(row, ["cpc", "cp"])),
    url,
    trafficPercent: nullableNumber(
      readCell(row, ["traffic", "trafficpercent", "tr"]),
    ),
    trafficCostPercent: nullableNumber(
      readCell(row, ["trafficcost", "trafficcostpercent", "tc"]),
    ),
    competition: nullableNumber(readCell(row, ["competition", "co"])),
    results: nullableNumber(
      readCell(row, ["numberofresults", "results", "nr"]),
    ),
    trends: nullableString(readCell(row, ["trends", "td"])),
    timestamp: nullableString(readCell(row, ["timestamp", "ts"])),
    sourceFile,
  };
}

function parseCsv(
  content: string,
  relativePath: string,
  malformed: MalformedRow[],
): CsvRow[] {
  if (!content.trim() || /^ERROR\b/iu.test(content.trim())) return [];
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });
  for (const error of parsed.errors) {
    malformed.push({
      file: relativePath,
      row: (error.row ?? 0) + 2,
      reason: `CSV parse error: ${error.message}`,
    });
  }
  return parsed.data.map((row, index) => ({ row, rowNumber: index + 2 }));
}

function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

function readCell(
  row: Record<string, string>,
  aliases: string[],
): string | undefined {
  for (const alias of aliases) {
    const value = row[normalizeHeader(alias)];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function nullableString(value: string | undefined): string | null {
  return value?.trim() || null;
}

function nullableNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function sameEntity<T extends { sourceFile: string }>(
  left: T,
  right: T,
): boolean {
  const { sourceFile: _leftSource, ...leftComparable } = left;
  const { sourceFile: _rightSource, ...rightComparable } = right;
  return JSON.stringify(leftComparable) === JSON.stringify(rightComparable);
}

function groupProjectDomains(
  projects: NormalizedProject[],
): Map<string, NormalizedProject[]> {
  const result = new Map<string, NormalizedProject[]>();
  for (const project of projects) {
    if (!project.domain) continue;
    result.set(project.domain, [
      ...(result.get(project.domain) ?? []),
      project,
    ]);
  }
  return result;
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

function firstUnknown(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }
  return undefined;
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  const value = firstUnknown(record, keys);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

interface StageFile {
  relativePath: string;
  content: string;
  contentType: string;
  recordCount: number;
}

async function writeStage(options: {
  outputDir: string;
  manifest: ImportManifest;
  stage: string;
  files: StageFile[];
  now: () => Date;
  logger: Logger;
}): Promise<void> {
  const current = options.manifest.stages[options.stage];
  if (
    current?.status === "complete" &&
    (await allStageFilesValid(
      options.outputDir,
      options.manifest,
      options.files,
    ))
  ) {
    options.logger.info(`Resume: ${options.stage} stage already complete.`);
    return;
  }

  for (const file of options.files) {
    const filePath = resolveWithin(options.outputDir, file.relativePath);
    await atomicWrite(filePath, file.content);
    const fileStat = await stat(filePath);
    options.manifest.files[file.relativePath] = {
      sha256: await sha256File(filePath),
      bytes: fileStat.size,
      contentType: file.contentType,
      recordCount: file.recordCount,
      stage: options.stage,
    };
  }
  const timestamp = nowIso(options.now);
  options.manifest.stages[options.stage] = {
    status: "complete",
    updatedAt: timestamp,
  };
  options.manifest.completedAt = undefined;
  options.manifest.updatedAt = timestamp;
  await writeImportState(options.outputDir, options.manifest);
}

async function allStageFilesValid(
  outputDir: string,
  manifest: ImportManifest,
  files: StageFile[],
): Promise<boolean> {
  for (const file of files) {
    const record = manifest.files[file.relativePath];
    if (
      !record ||
      !(await fileMatchesRecord(outputDir, file.relativePath, record))
    ) {
      return false;
    }
  }
  return true;
}

function renderNdjson(rows: unknown[]): string {
  return rows.length > 0
    ? `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`
    : "";
}

async function cli(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) {
    throw new Error(
      "Usage: pnpm semrush:import --input <archive-directory> --output <bundle-directory> [--dry-run] [--allow-incomplete-source]",
    );
  }
  await runImport({
    inputDir: args.input,
    outputDir: args.output,
    dryRun: args["dry-run"] === "true",
    allowIncompleteSource: args["allow-incomplete-source"] === "true",
  });
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
