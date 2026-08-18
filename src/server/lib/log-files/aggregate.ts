import {
  MAX_PENDING_BOT_IPS,
  type BotVerification,
  type LogFileBotId,
  type LogFileFormat,
} from "@/shared/log-files";
import { identifyClaimedBot, verifyClaimedBot, type DnsLookups } from "./bots";
import { ipMatchesPublishedRange } from "./ip-ranges";
import {
  detectLogFormat,
  parseLogLine,
  parseW3cFieldsLine,
  readLogLines,
  type ParsedLogLine,
} from "./parse";

export type PathDailyAggregate = {
  botId: LogFileBotId;
  day: string;
  path: string;
  requests: number;
  verifiedRequests: number;
  bytesTotal: number;
  responseTimeMsSum: number;
  responseTimeSamples: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
};

export type BotSummaryAggregate = {
  botId: LogFileBotId;
  requests: number;
  verifiedRequests: number;
  unverifiedRequests: number;
  uniqueIpsClaimed: number;
};

export type ParseAggregateResult = {
  format: LogFileFormat;
  linesParsed: number;
  linesSkipped: number;
  dateFrom: string | null;
  dateTo: string | null;
  bots: BotSummaryAggregate[];
  pathDaily: PathDailyAggregate[];
};

type PendingLine = {
  line: ParsedLogLine;
  botId: LogFileBotId;
};

function emptyPath(
  botId: LogFileBotId,
  day: string,
  path: string,
): PathDailyAggregate {
  return {
    botId,
    day,
    path,
    requests: 0,
    verifiedRequests: 0,
    bytesTotal: 0,
    responseTimeMsSum: 0,
    responseTimeSamples: 0,
    status2xx: 0,
    status3xx: 0,
    status4xx: 0,
    status5xx: 0,
  };
}

function addLine(
  row: PathDailyAggregate,
  line: ParsedLogLine,
  verification: BotVerification,
) {
  row.requests += 1;
  if (verification === "verified") row.verifiedRequests += 1;
  row.bytesTotal += line.bytes;
  if (line.responseTimeMs !== null) {
    row.responseTimeMsSum += line.responseTimeMs;
    row.responseTimeSamples += 1;
  }
  if (line.status >= 200 && line.status < 300) row.status2xx += 1;
  else if (line.status >= 300 && line.status < 400) row.status3xx += 1;
  else if (line.status >= 400 && line.status < 500) row.status4xx += 1;
  else if (line.status >= 500) row.status5xx += 1;
}

function pathKey(botId: string, day: string, path: string) {
  return `${botId}\t${day}\t${path}`;
}

export async function aggregateLogStream(
  stream: ReadableStream<Uint8Array>,
  lookups?: DnsLookups,
): Promise<ParseAggregateResult> {
  const sample: string[] = [];
  const pendingByIp = new Map<string, PendingLine[]>();
  const verifiedCache = new Map<string, BotVerification>();
  const claimedIps = new Map<LogFileBotId, Set<string>>();
  const pathDaily = new Map<string, PathDailyAggregate>();
  const botTotals = new Map<LogFileBotId, BotSummaryAggregate>();
  let format: LogFileFormat | null = null;
  let w3cFields: string[] | null = null;
  let linesParsed = 0;
  let linesSkipped = 0;
  let dateFrom: string | null = null;
  let dateTo: string | null = null;

  function ensureBot(botId: LogFileBotId) {
    const existing = botTotals.get(botId);
    if (existing) return existing;
    const created: BotSummaryAggregate = {
      botId,
      requests: 0,
      verifiedRequests: 0,
      unverifiedRequests: 0,
      uniqueIpsClaimed: 0,
    };
    botTotals.set(botId, created);
    return created;
  }

  function record(
    line: ParsedLogLine,
    botId: LogFileBotId,
    verified: BotVerification,
  ) {
    const key = pathKey(botId, line.day, line.path);
    const row = pathDaily.get(key) ?? emptyPath(botId, line.day, line.path);
    addLine(row, line, verified);
    pathDaily.set(key, row);
    const bot = ensureBot(botId);
    bot.requests += 1;
    if (verified === "verified") bot.verifiedRequests += 1;
    else bot.unverifiedRequests += 1;
    if (!dateFrom || line.day < dateFrom) dateFrom = line.day;
    if (!dateTo || line.day > dateTo) dateTo = line.day;
  }

  function consumeLine(raw: string, activeFormat: LogFileFormat) {
    if (raw.startsWith("#Fields:")) {
      w3cFields = parseW3cFieldsLine(raw) ?? w3cFields;
      return;
    }
    const parsed = parseLogLine(raw, activeFormat, w3cFields);
    if (!parsed) {
      if (raw.trim() && !raw.startsWith("#")) linesSkipped += 1;
      return;
    }
    linesParsed += 1;
    const botId = identifyClaimedBot(parsed.userAgent);
    if (!botId) return;

    const ips = claimedIps.get(botId) ?? new Set<string>();
    ips.add(parsed.ip);
    claimedIps.set(botId, ips);

    const cacheKey = `${botId}|${parsed.ip}`;
    const cached = verifiedCache.get(cacheKey);
    if (cached) {
      record(parsed, botId, cached);
      return;
    }
    if (ipMatchesPublishedRange(parsed.ip, botId)) {
      verifiedCache.set(cacheKey, "verified");
      record(parsed, botId, "verified");
      return;
    }

    const pending = pendingByIp.get(parsed.ip) ?? [];
    if (pending.length === 0 && pendingByIp.size >= MAX_PENDING_BOT_IPS) {
      record(parsed, botId, "unverified");
      return;
    }
    pending.push({ line: parsed, botId });
    pendingByIp.set(parsed.ip, pending);
  }

  function handleLine(raw: string) {
    if (raw.startsWith("#Fields:")) {
      w3cFields = parseW3cFieldsLine(raw) ?? w3cFields;
      return;
    }
    if (!format) {
      sample.push(raw);
      format = detectLogFormat(sample);
      if (!format) {
        if (sample.length >= 40 && raw.trim() && !raw.startsWith("#")) {
          linesSkipped += 1;
        }
        return;
      }
      for (const buffered of sample) consumeLine(buffered, format);
      return;
    }
    consumeLine(raw, format);
  }

  await readLogLines(stream, handleLine);

  if (!format) {
    format = detectLogFormat(sample);
  }
  if (!format) {
    return {
      format: "combined",
      linesParsed,
      linesSkipped: linesSkipped + linesParsed,
      dateFrom: null,
      dateTo: null,
      bots: [],
      pathDaily: [],
    };
  }

  for (const [ip, pending] of pendingByIp) {
    const first = pending[0];
    if (!first) continue;
    const verified = await verifyClaimedBot(ip, first.botId, lookups);
    verifiedCache.set(`${first.botId}|${ip}`, verified);
    for (const item of pending) {
      record(item.line, item.botId, verified);
    }
  }

  for (const [botId, ips] of claimedIps) {
    ensureBot(botId).uniqueIpsClaimed = ips.size;
  }

  return {
    format,
    linesParsed,
    linesSkipped,
    dateFrom,
    dateTo,
    bots: [...botTotals.values()],
    pathDaily: [...pathDaily.values()],
  };
}
