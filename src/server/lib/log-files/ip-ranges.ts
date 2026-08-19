import type { LogFileBotId } from "@/shared/log-files";

type Cidr = { network: number; mask: number };

function parseIpv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function parseCidr(cidr: string): Cidr {
  const [ip, bitsRaw] = cidr.split("/");
  const network = parseIpv4(ip ?? "");
  const bits = Number(bitsRaw);
  if (network === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: network & mask, mask };
}

const cidrs = (...values: string[]) => values.map(parseCidr);

/**
 * Published crawler prefixes used when reverse DNS is unavailable (Workers
 * has no node:dns). Snapshot of official Googlebot / Bingbot / OpenAI lists;
 * unmatched claimed bots stay unverified rather than trusted from UA.
 */
const BOT_IPV4_RANGES: Partial<Record<LogFileBotId, Cidr[]>> = {
  googlebot: cidrs(
    "66.249.64.0/19",
    "64.233.160.0/19",
    "72.14.192.0/18",
    "74.125.0.0/16",
    "108.177.8.0/21",
    "142.250.0.0/15",
    "172.217.0.0/16",
    "173.194.0.0/16",
    "209.85.128.0/17",
    "216.58.192.0/19",
    "216.239.32.0/19",
    "34.64.82.0/24",
    "34.100.182.0/24",
    "34.101.100.0/24",
  ),
  bingbot: cidrs(
    "13.66.139.0/24",
    "13.66.144.0/24",
    "40.77.167.0/24",
    "40.77.188.0/24",
    "52.167.144.0/24",
    "157.55.16.0/23",
    "157.55.18.0/24",
    "157.55.32.0/22",
    "157.55.36.0/24",
    "157.55.39.0/24",
    "157.55.48.0/24",
    "157.56.92.0/24",
    "199.30.16.0/24",
    "207.46.12.0/23",
    "207.46.13.0/24",
  ),
  "oai-searchbot": cidrs(
    "20.15.240.64/28",
    "20.15.240.80/28",
    "23.98.142.176/28",
    "52.230.152.0/24",
    "52.233.106.0/24",
  ),
  "chatgpt-user": cidrs(
    "20.15.240.64/28",
    "20.15.240.80/28",
    "23.98.142.176/28",
    "52.230.152.0/24",
    "52.233.106.0/24",
  ),
};

export function ipMatchesPublishedRange(
  ip: string,
  botId: LogFileBotId,
): boolean {
  const value = parseIpv4(ip);
  if (value === null) return false;
  const ranges = BOT_IPV4_RANGES[botId];
  if (!ranges) return false;
  return ranges.some((range) => (value & range.mask) === range.network);
}
