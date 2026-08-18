import type { DnsLookups } from "./bots";

type DnsJson = {
  Answer?: { type: number; data: string }[];
};

const PTR = 12;
const A = 1;
const AAAA = 28;

function reverseName(ip: string): string | null {
  const v4 = ip.split(".");
  if (v4.length === 4 && v4.every((part) => /^\d{1,3}$/.test(part))) {
    return `${v4.toReversed().join(".")}.in-addr.arpa`;
  }
  return null;
}

async function queryDns(name: string, type: "PTR" | "A" | "AAAA") {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);
  const response = await fetch(url, {
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return [];
  const body: DnsJson = await response.json();
  return body.Answer ?? [];
}

/**
 * Workers has no node:dns. Cloudflare's public DoH resolver is free and is
 * only used to forward-confirm claimed Googlebot/Bingbot IPs.
 */
export const dohLookups: DnsLookups = {
  async reverse(ip) {
    const name = reverseName(ip);
    if (!name) return null;
    const answers = await queryDns(name, "PTR");
    const ptr = answers.find((answer) => answer.type === PTR)?.data;
    return ptr ? ptr.replace(/\.$/, "") : null;
  },
  async forward(hostname) {
    const [a, aaaa] = await Promise.all([
      queryDns(hostname, "A"),
      queryDns(hostname, "AAAA"),
    ]);
    return [...a, ...aaaa]
      .filter((answer) => answer.type === A || answer.type === AAAA)
      .map((answer) => answer.data.replace(/\.$/, ""));
  },
};
