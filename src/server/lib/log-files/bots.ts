import {
  LOG_FILE_BOT_IDS,
  type BotVerification,
  type LogFileBotId,
} from "@/shared/log-files";
import { ipMatchesPublishedRange } from "./ip-ranges";

const BOT_UA_PATTERNS: { botId: LogFileBotId; pattern: RegExp }[] = [
  { botId: "googlebot", pattern: /googlebot/i },
  { botId: "bingbot", pattern: /bingbot/i },
  { botId: "oai-searchbot", pattern: /oai-searchbot/i },
  { botId: "chatgpt-user", pattern: /chatgpt-user/i },
  { botId: "perplexitybot", pattern: /perplexitybot/i },
  { botId: "claude-searchbot", pattern: /claude-searchbot/i },
];

const DNS_SUFFIX: Partial<Record<LogFileBotId, string[]>> = {
  googlebot: [".googlebot.com", ".google.com"],
  bingbot: [".search.msn.com"],
};

export type DnsLookups = {
  reverse: (ip: string) => Promise<string | null>;
  forward: (hostname: string) => Promise<string[]>;
};

export function identifyClaimedBot(userAgent: string): LogFileBotId | null {
  for (const { botId, pattern } of BOT_UA_PATTERNS) {
    if (pattern.test(userAgent)) return botId;
  }
  return null;
}

export function isKnownBotId(value: string): value is LogFileBotId {
  return (LOG_FILE_BOT_IDS as readonly string[]).includes(value);
}

function hostnameMatchesSuffix(hostname: string, suffixes: string[]) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return suffixes.some((suffix) => host.endsWith(suffix));
}

/**
 * Forward-confirmed reverse DNS. Workers has no node:dns, so callers inject
 * DNS-over-HTTPS (or a test double). A failed lookup is not a pass.
 */
export async function confirmBotByReverseDns(
  ip: string,
  botId: LogFileBotId,
  lookups: DnsLookups,
): Promise<boolean> {
  const suffixes = DNS_SUFFIX[botId];
  if (!suffixes) return false;
  const hostname = await lookups.reverse(ip);
  if (!hostname || !hostnameMatchesSuffix(hostname, suffixes)) return false;
  const forwards = await lookups.forward(hostname);
  return forwards.includes(ip);
}

export async function verifyClaimedBot(
  ip: string,
  botId: LogFileBotId,
  lookups?: DnsLookups,
): Promise<BotVerification> {
  if (ipMatchesPublishedRange(ip, botId)) return "verified";
  if (!lookups) return "unverified";
  try {
    return (await confirmBotByReverseDns(ip, botId, lookups))
      ? "verified"
      : "unverified";
  } catch {
    return "unverified";
  }
}
