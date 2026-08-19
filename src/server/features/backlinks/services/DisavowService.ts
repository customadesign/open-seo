import Papa from "papaparse";
import { DisavowRepository } from "@/server/features/backlinks/repositories/DisavowRepository";
import { AppError } from "@/server/lib/errors";
import type {
  DisavowEntryType,
  DisavowSource,
  DisavowStatus,
  ImportDisavowEntriesInput,
  SaveDisavowEntryInput,
} from "@/types/schemas/disavow";

type ImportedEntry = {
  entryType: DisavowEntryType;
  value: string;
  status: DisavowStatus;
  comments: string | null;
  source: DisavowSource;
  linkCount: number;
};

const MAX_GOOGLE_LINES = 100_000;
const MAX_GOOGLE_BYTES = 2_000_000;

function normalizeDomain(input: string) {
  const value = input.trim().replace(/^domain\s*:/i, "");
  if (!value || value.includes("*") || /[\s\\]/.test(value)) {
    throw new AppError("VALIDATION_ERROR", "Invalid disavow domain.");
  }
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `http://${value}`);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Invalid disavow domain.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname.includes(".") ||
    hostname.length > 253 ||
    url.username ||
    url.password ||
    url.port ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new AppError("VALIDATION_ERROR", "Invalid disavow domain.");
  }
  return hostname;
}

function normalizeUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError("VALIDATION_ERROR", "Invalid disavow URL.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new AppError("VALIDATION_ERROR", "Invalid disavow URL.");
  }
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  const normalized = url.toString();
  if (normalized.length > 2048) {
    throw new AppError("VALIDATION_ERROR", "Disavow URL is too long.");
  }
  return normalized;
}

export function normalizeDisavowValue(
  entryType: DisavowEntryType,
  value: string,
) {
  return entryType === "domain" ? normalizeDomain(value) : normalizeUrl(value);
}

/** Words that mark the decision as an explicit "leave this link alone". */
const KEEP_WORDS = new Set([
  "keep",
  "keeps",
  "keeping",
  "kept",
  "whitelist",
  "whitelisted",
  "whitelisting",
]);

/** Words that invert the verb that follows them. */
const NEGATION_WORDS = new Set([
  "not",
  "no",
  "never",
  "dont",
  "doesnt",
  "didnt",
  "wont",
  "cannot",
  "cant",
  "exclude",
  "excluded",
  "excluding",
  "without",
]);

/** Exact words that carry a decision, mapped to the decision they carry. */
const DECISION_WORDS = new Map<string, "export" | "disavow" | "remove">([
  ["export", "export"],
  ["exported", "export"],
  ["exports", "export"],
  ["exporting", "export"],
  ["disavow", "disavow"],
  ["disavowed", "disavow"],
  ["disavows", "disavow"],
  ["disavowing", "disavow"],
  ["remove", "remove"],
  ["removed", "remove"],
  ["removes", "remove"],
  ["removal", "remove"],
]);

/** How many preceding words a negation can reach ("not yet exported"). */
const NEGATION_REACH = 3;

/**
 * SEMrush status/action columns are free text and routinely negated: "Do not
 * disavow", "Not exported", "Whitelist - do not disavow". Substring matching
 * read every one of those as a positive decision, which is how a deliberately
 * kept domain ended up in the Google disavow file. Match whole words instead
 * and resolve a negated verb to a decision that cannot be exported: a negated
 * disavow is a considered "kept", anything else falls back to "pending".
 */
function statusFromSemrush(value: string | undefined): DisavowStatus {
  const words = (value ?? "")
    .toLowerCase()
    .replaceAll(/['’]/gu, "")
    .split(/[^a-z]+/u)
    .filter(Boolean);
  if (words.some((word) => KEEP_WORDS.has(word))) return "kept";

  const decisions = words.flatMap((word, index) => {
    const decision = DECISION_WORDS.get(word);
    if (!decision) return [];
    const negated = words
      .slice(Math.max(0, index - NEGATION_REACH), index)
      .some((earlier) => NEGATION_WORDS.has(earlier));
    return [{ decision, negated }];
  });
  const asserts = (decision: "export" | "disavow" | "remove") =>
    decisions.some((entry) => entry.decision === decision && !entry.negated);

  if (
    decisions.some((entry) => entry.decision === "disavow" && entry.negated)
  ) {
    return "kept";
  }
  if (asserts("export")) return "exported";
  if (asserts("disavow")) return "disavowed";
  if (asserts("remove")) return "removal_requested";
  return "pending";
}

function firstValue(
  row: Record<string, string>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = row[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function parseLinkCount(value: string | undefined) {
  if (!value) return 0;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(2_147_483_647, Math.trunc(parsed)))
    : 0;
}

export function parseSemrushDisavowCsv(content: string): ImportedEntry[] {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) =>
      header
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_"),
  });
  if (parsed.errors.length > 0) {
    throw new AppError("VALIDATION_ERROR", "Invalid SEMrush CSV file.");
  }

  const entries: ImportedEntry[] = [];
  for (const row of parsed.data) {
    const domain = firstValue(row, [
      "domain",
      "referring_domain",
      "source_domain",
    ]);
    const url = firstValue(row, [
      "url",
      "source_url",
      "backlink",
      "page_as_source",
    ]);
    const rawType = firstValue(row, ["type", "entry_type", "disavow_as"]);
    const entryType: DisavowEntryType =
      rawType?.toLowerCase().includes("domain") || (domain && !url)
        ? "domain"
        : "url";
    const rawValue = entryType === "domain" ? (domain ?? url) : (url ?? domain);
    if (!rawValue) continue;
    try {
      const status = statusFromSemrush(
        firstValue(row, ["status", "action", "decision"]),
      );
      entries.push({
        entryType,
        value: normalizeDisavowValue(entryType, rawValue),
        status,
        comments:
          firstValue(row, ["comments", "comment", "notes", "note"]) ?? null,
        source: "semrush_csv",
        linkCount: parseLinkCount(
          firstValue(row, ["link_count", "links", "backlinks"]),
        ),
      });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
  return entries;
}

export function parseGoogleDisavowTxt(content: string): ImportedEntry[] {
  const entries: ImportedEntry[] = [];
  let comments: string[] = [];
  for (const sourceLine of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) {
      comments = [];
      continue;
    }
    if (line.startsWith("#")) {
      comments.push(line.slice(1).trim());
      continue;
    }
    const entryType: DisavowEntryType = /^domain\s*:/i.test(line)
      ? "domain"
      : "url";
    try {
      entries.push({
        entryType,
        value: normalizeDisavowValue(entryType, line),
        status: "exported",
        comments: comments.filter(Boolean).join("\n") || null,
        source: "google_txt",
        linkCount: 0,
      });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
    comments = [];
  }
  return entries;
}

function dedupeEntries(entries: ImportedEntry[]) {
  const deduped = new Map<string, ImportedEntry>();
  for (const entry of entries) {
    deduped.set(`${entry.entryType}:${entry.value}`, entry);
  }
  return [...deduped.values()];
}

async function save(input: SaveDisavowEntryInput) {
  const { projectId, id, entryType, value, ...fields } = input;
  const entry = await DisavowRepository.saveManual({
    id,
    projectId,
    entryType,
    value: normalizeDisavowValue(entryType, value),
    ...fields,
    exportedAt: null,
  });
  if (!entry) throw new AppError("NOT_FOUND", "Disavow entry not found.");
  return entry;
}

async function importEntries(input: ImportDisavowEntriesInput) {
  const parsed =
    input.format === "semrush_csv"
      ? parseSemrushDisavowCsv(input.content)
      : parseGoogleDisavowTxt(input.content);
  const entries = dedupeEntries(parsed);
  if (entries.length === 0) {
    throw new AppError("VALIDATION_ERROR", "No valid disavow entries found.");
  }
  const now = new Date().toISOString();
  await DisavowRepository.importMany(
    entries.map((entry) => ({
      ...entry,
      id: crypto.randomUUID(),
      projectId: input.projectId,
      exportedAt: entry.status === "exported" ? now : null,
      createdAt: now,
      updatedAt: now,
    })),
  );
  return { imported: entries.length };
}

function sanitizeCommentLine(line: string) {
  let normalized = "";
  for (let index = 0; index < line.length; index += 1) {
    const code = line.charCodeAt(index);
    normalized += code < 32 || code === 127 ? " " : line[index];
  }
  return normalized.trim();
}

function sanitizeCommentLines(comments: string | null) {
  if (!comments) return [];
  return comments
    .split(/\r?\n/)
    .map(sanitizeCommentLine)
    .filter(Boolean)
    .map((line) => `# ${line}`);
}

export function buildGoogleDisavowTxt(
  entries: Array<{
    entryType: DisavowEntryType;
    value: string;
    comments: string | null;
    linkCount: number;
  }>,
) {
  const sorted = entries.toSorted((a, b) => {
    const byType = a.entryType.localeCompare(b.entryType);
    return byType || a.value.localeCompare(b.value);
  });
  const lines = [
    "# OpenSEO disavow export",
    "# Review carefully before manually uploading to Google Search Console",
    "",
  ];
  for (const entry of sorted) {
    lines.push(...sanitizeCommentLines(entry.comments));
    if (entry.linkCount > 0) lines.push(`# observed links: ${entry.linkCount}`);
    lines.push(
      entry.entryType === "domain" ? `domain:${entry.value}` : entry.value,
    );
  }
  const content = `${lines.join("\n")}\n`;
  if (lines.length > MAX_GOOGLE_LINES) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Disavow export exceeds 100,000 lines.",
    );
  }
  if (new TextEncoder().encode(content).byteLength > MAX_GOOGLE_BYTES) {
    throw new AppError("VALIDATION_ERROR", "Disavow export exceeds 2 MB.");
  }
  return content;
}

async function exportGoogleTxt(projectId: string) {
  const entries = await DisavowRepository.listExportable(projectId);
  const content = buildGoogleDisavowTxt(entries);
  const exportedAt = new Date().toISOString();
  await DisavowRepository.markExported(
    projectId,
    entries.map((entry) => entry.id),
    exportedAt,
  );
  return { content, entryCount: entries.length, exportedAt };
}

export const DisavowService = {
  list: DisavowRepository.list,
  save,
  importEntries,
  remove: DisavowRepository.remove,
  exportGoogleTxt,
} as const;
