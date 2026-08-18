import { createHash } from "node:crypto";
import {
  mkdir,
  lstat,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const ARCHIVE_MANIFEST_FILE = "manifest.json";
export const CHECKSUM_FILE = "checksums.sha256";
export const IMPORT_MANIFEST_FILE = "import-manifest.json";

const fileRecordSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.number().int().nonnegative(),
  contentType: z.string().min(1),
  endpointId: z.string().min(1),
  recordCount: z.number().int().nonnegative().optional(),
});

const endpointCheckpointSchema = z.object({
  id: z.string().min(1),
  api: z.enum(["management", "analytics"]),
  type: z.string().min(1),
  domain: z.string().optional(),
  database: z.string().optional(),
  status: z.enum(["pending", "running", "complete", "failed"]),
  attempts: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().optional(),
  pages: z.array(z.string()).optional(),
  updatedAt: z.string(),
  error: z.string().optional(),
  nothingFound: z.boolean().optional(),
});

export const archiveManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("semrush-archive"),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  options: z.object({
    databases: z.array(z.string()),
    domains: z.array(z.string()),
    domainSource: z.enum(["explicit", "management-projects"]),
    pageSize: z.number().int().positive(),
    maxPages: z.number().int().positive(),
  }),
  endpoints: z.record(z.string(), endpointCheckpointSchema),
  files: z.record(z.string(), fileRecordSchema),
});

export type ArchiveManifest = z.infer<typeof archiveManifestSchema>;
export type ArchiveFileRecord = z.infer<typeof fileRecordSchema>;
export type EndpointCheckpoint = z.infer<typeof endpointCheckpointSchema>;

const importStageSchema = z.object({
  status: z.enum(["pending", "complete"]),
  updatedAt: z.string(),
});

export const importManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("semrush-import-bundle"),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  sourceManifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  stages: z.record(z.string(), importStageSchema),
  files: z.record(
    z.string(),
    fileRecordSchema.omit({ endpointId: true }).extend({
      stage: z.string().min(1),
    }),
  ),
});

export type ImportManifest = z.infer<typeof importManifestSchema>;

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
};

export function sha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

export async function atomicWrite(
  filePath: string,
  content: string | Uint8Array,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, content);
  await rename(temporaryPath, filePath);
}

export function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\n") ||
    normalized.includes("\r")
  ) {
    throw new Error(`Unsafe manifest path: ${JSON.stringify(relativePath)}`);
  }
  return normalized;
}

export function resolveWithin(root: string, relativePath: string): string {
  const safePath = normalizeRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, safePath);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(
      `Manifest path escapes its root: ${JSON.stringify(relativePath)}`,
    );
  }
  return resolved;
}

export async function fileMatchesRecord(
  root: string,
  relativePath: string,
  record: { sha256: string; bytes: number },
): Promise<boolean> {
  try {
    const filePath = resolveWithin(root, relativePath);
    const linkStat = await lstat(filePath);
    if (linkStat.isSymbolicLink()) {
      throw new Error(`Manifest file must not be a symlink: ${relativePath}`);
    }
    if (!linkStat.isFile() || linkStat.size !== record.bytes) return false;
    return (await sha256File(filePath)) === record.sha256;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

export async function recordFile(
  root: string,
  relativePath: string,
  details: Omit<ArchiveFileRecord, "sha256" | "bytes">,
): Promise<ArchiveFileRecord> {
  const filePath = resolveWithin(root, relativePath);
  const fileStat = await lstat(filePath);
  if (fileStat.isSymbolicLink()) {
    throw new Error(`Archive file must not be a symlink: ${relativePath}`);
  }
  return {
    ...details,
    sha256: await sha256File(filePath),
    bytes: fileStat.size,
  };
}

export async function writeArchiveState(
  root: string,
  manifest: ArchiveManifest,
): Promise<void> {
  archiveManifestSchema.parse(manifest);
  await atomicWrite(
    path.join(root, ARCHIVE_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await atomicWrite(
    path.join(root, CHECKSUM_FILE),
    renderChecksums(manifest.files),
  );
}

export async function writeImportState(
  root: string,
  manifest: ImportManifest,
): Promise<void> {
  importManifestSchema.parse(manifest);
  await atomicWrite(
    path.join(root, IMPORT_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await atomicWrite(
    path.join(root, CHECKSUM_FILE),
    renderChecksums(manifest.files),
  );
}

function renderChecksums(files: Record<string, { sha256: string }>): string {
  const lines = Object.entries(files)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, record]) => {
      const safePath = normalizeRelativePath(relativePath);
      return `${record.sha256}  ${safePath}`;
    });
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export async function loadArchiveManifest(
  root: string,
): Promise<ArchiveManifest> {
  const content = await readFile(
    path.join(root, ARCHIVE_MANIFEST_FILE),
    "utf8",
  );
  return archiveManifestSchema.parse(JSON.parse(content));
}

export async function loadImportManifest(
  root: string,
): Promise<ImportManifest> {
  const content = await readFile(path.join(root, IMPORT_MANIFEST_FILE), "utf8");
  return importManifestSchema.parse(JSON.parse(content));
}

export async function readOptionalArchiveManifest(
  root: string,
): Promise<ArchiveManifest | null> {
  try {
    return await loadArchiveManifest(root);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export async function readOptionalImportManifest(
  root: string,
): Promise<ImportManifest | null> {
  try {
    return await loadImportManifest(root);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

export async function assertDirectoryEmptyOrMissing(
  root: string,
): Promise<void> {
  try {
    const entries = (await readdir(root)).filter(
      (entry) => entry !== ".DS_Store",
    );
    if (entries.length > 0) {
      throw new Error(
        `Directory is not empty and has no resumable manifest: ${root} (${entries.slice(0, 5).join(", ")})`,
      );
    }
  } catch (error) {
    if (isMissingFileError(error)) return;
    throw error;
  }
}

export async function verifyChecksums(
  root: string,
  files: Record<string, { sha256: string; bytes: number }>,
): Promise<void> {
  const checksumContent = await readFile(
    path.join(root, CHECKSUM_FILE),
    "utf8",
  );
  const checksumEntries = parseChecksums(checksumContent);
  const manifestPaths = Object.keys(files).sort();
  const checksumPaths = [...checksumEntries.keys()].sort();
  if (JSON.stringify(manifestPaths) !== JSON.stringify(checksumPaths)) {
    throw new Error(
      "Checksum file does not list the same files as the manifest.",
    );
  }

  for (const relativePath of manifestPaths) {
    const record = files[relativePath];
    if (checksumEntries.get(relativePath) !== record.sha256) {
      throw new Error(`Checksum metadata mismatch for ${relativePath}.`);
    }
    if (!(await fileMatchesRecord(root, relativePath, record))) {
      throw new Error(`Checksum verification failed for ${relativePath}.`);
    }
  }
}

function parseChecksums(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of content.split(/\r?\n/u)) {
    if (!line) continue;
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) throw new Error("Invalid checksums.sha256 format.");
    const relativePath = normalizeRelativePath(match[2]);
    if (result.has(relativePath)) {
      throw new Error(`Duplicate checksum entry for ${relativePath}.`);
    }
    result.set(relativePath, match[1]);
  }
  return result;
}

export function redactSecrets(
  value: unknown,
  secrets: ReadonlyArray<string> = [],
): string {
  let text = value instanceof Error ? value.message : String(value);
  if (value instanceof Error && value.cause != null && value.cause !== value) {
    const causeText =
      value.cause instanceof Error ? value.cause.message : String(value.cause);
    text += ` (cause: ${causeText})`;
  }
  for (const secret of secrets) {
    if (secret) text = text.replaceAll(secret, "[REDACTED]");
  }
  text = text
    .replace(/([?&](?:key|api_key)=)[^&\s]+/giu, "$1[REDACTED]")
    .replace(/(SEMRUSH_API_KEY\s*[=:]\s*)\S+/giu, "$1[REDACTED]")
    .replace(/\b[0-9a-f]{32}\b/giu, "[REDACTED]");
  return text;
}

export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const trimmed = input.trim().toLowerCase();
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`,
    );
    return url.hostname.replace(/^www\./u, "") || null;
  } catch {
    return (
      trimmed
        .replace(/^https?:\/\//u, "")
        .split("/")[0]
        .replace(/^www\./u, "") || null
    );
  }
}

export function slugForPath(value: string): string {
  const normalized = normalizeDomain(value) ?? value.toLowerCase();
  return normalized.replace(/[^a-z0-9.-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

export function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function nowIso(now: () => Date): string {
  return now().toISOString();
}
