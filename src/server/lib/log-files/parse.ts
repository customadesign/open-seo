import { MAX_LOG_PATH_LENGTH, type LogFileFormat } from "@/shared/log-files";

const MONTHS: Record<string, string> = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

const CLF_LINE =
  /^(\S+) \S+ \S+ \[([^\]]+)] "(\S+)\s+([^"]*?)\s*(?:HTTP\/[\d.]+)?" (\d{3}|-) (\d+|-)/;

const COMBINED_TAIL = /^ "((?:\\.|[^"\\])*)" "((?:\\.|[^"\\])*)"(?:\s+(\S+))?/;

const W3C_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;

export type ParsedLogLine = {
  ip: string;
  day: string;
  method: string;
  path: string;
  status: number;
  bytes: number;
  userAgent: string;
  responseTimeMs: number | null;
};

function clfDay(stamp: string): string | null {
  const match = stamp.match(
    /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/,
  );
  if (!match) return null;
  const month = MONTHS[match[2] ?? ""];
  if (!month) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offset = match[7] ?? "+0000";
  const sign = offset.startsWith("-") ? -1 : 1;
  const offsetMinutes =
    sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5)));
  const utcMs = Date.UTC(year, Number(month) - 1, day, hour, minute, second);
  if (!Number.isFinite(utcMs)) return null;
  return new Date(utcMs - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function parseRequestTarget(raw: string): string | null {
  const target = raw.trim();
  if (!target || target === "*") return null;
  if (target.length > MAX_LOG_PATH_LENGTH) return null;
  if (target.startsWith("/")) {
    const path = target.split(" ")[0] ?? target;
    return path.length > 0 && path.length <= MAX_LOG_PATH_LENGTH ? path : null;
  }
  try {
    const url = new URL(target);
    const path = `${url.pathname}${url.search}`;
    return path.length > 0 && path.length <= MAX_LOG_PATH_LENGTH ? path : null;
  } catch {
    return null;
  }
}

function parseStatus(raw: string): number | null {
  if (raw === "-") return null;
  const status = Number(raw);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

function parseBytes(raw: string): number {
  if (raw === "-") return 0;
  const bytes = Number(raw);
  return Number.isInteger(bytes) && bytes >= 0 ? bytes : 0;
}

/**
 * Access logs record request time as seconds, milliseconds, or microseconds
 * depending on the server. Values above five minutes are treated as the next
 * finer unit so a 120s nginx timer and a 120000 Apache %D stay distinct.
 */
export function normalizeResponseTimeMs(
  raw: string | undefined,
): number | null {
  if (!raw || raw === "-") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value <= 300) return Math.round(value * 1000);
  if (value < 300_000) return Math.round(value);
  return Math.round(value / 1000);
}

function parseClfLine(
  line: string,
  expectCombined: boolean,
): ParsedLogLine | null {
  const match = line.match(CLF_LINE);
  if (!match) return null;
  const rest = line.slice(match[0].length);
  const tail = rest.match(COMBINED_TAIL);
  if (expectCombined && !tail) return null;
  const day = clfDay(match[2] ?? "");
  const path = parseRequestTarget(match[4] ?? "");
  const status = parseStatus(match[5] ?? "");
  if (!day || !path || status === null) return null;
  const userAgent = tail?.[2] ?? "";
  return {
    ip: match[1] ?? "",
    day,
    method: (match[3] ?? "").toUpperCase(),
    path,
    status,
    bytes: parseBytes(match[6] ?? "-"),
    userAgent,
    responseTimeMs: normalizeResponseTimeMs(tail?.[3]),
  };
}

function tokenizeW3c(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] ?? "";
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseW3cLine(
  line: string,
  fields: string[] | null,
): ParsedLogLine | null {
  if (!fields || line.startsWith("#")) return null;
  const tokens = tokenizeW3c(line);
  if (tokens.length < fields.length) return null;
  const value = (name: string) => {
    const index = fields.indexOf(name);
    return index >= 0 ? (tokens[index] ?? "-") : "-";
  };
  const date = value("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const stem = value("cs-uri-stem");
  const query = value("cs-uri-query");
  const pathRaw =
    query && query !== "-" ? `${stem === "-" ? "/" : stem}?${query}` : stem;
  const path = parseRequestTarget(pathRaw === "-" ? "/" : pathRaw);
  const status = parseStatus(value("sc-status"));
  if (!path || status === null) return null;
  return {
    ip: value("c-ip"),
    day: date,
    method: value("cs-method").toUpperCase(),
    path,
    status,
    bytes: parseBytes(value("sc-bytes")),
    userAgent: value("cs(User-Agent)").replace(/\+/g, " "),
    responseTimeMs: normalizeResponseTimeMs(value("time-taken")),
  };
}

export function detectLogFormat(sampleLines: string[]): LogFileFormat | null {
  let w3c = 0;
  let combined = 0;
  let common = 0;
  for (const line of sampleLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#Fields:") || trimmed.startsWith("#Version:")) {
      return "w3c";
    }
    if (W3C_DATE.test(trimmed) && !trimmed.startsWith("[")) {
      w3c += 1;
      continue;
    }
    if (parseClfLine(trimmed, true)) {
      combined += 1;
      continue;
    }
    if (parseClfLine(trimmed, false)) common += 1;
  }
  if (w3c > combined && w3c > common) return "w3c";
  if (combined >= common && combined > 0) return "combined";
  if (common > 0) return "common";
  return null;
}

export function parseW3cFieldsLine(line: string): string[] | null {
  if (!line.startsWith("#Fields:")) return null;
  const fields = line
    .slice("#Fields:".length)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return fields.length > 0 ? fields : null;
}

export function parseLogLine(
  line: string,
  format: LogFileFormat,
  w3cFields: string[] | null,
): ParsedLogLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (format === "w3c") return parseW3cLine(trimmed, w3cFields);
  return parseClfLine(trimmed, format === "combined");
}

export async function readLogLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void | Promise<void>,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const raw = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await onLine(raw.endsWith("\r") ? raw.slice(0, -1) : raw);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  if (buffer.length > 0) await onLine(buffer);
}
