import { afterEach, describe, expect, it, vi } from "vitest";
import {
  analyzeAiCrawlerAccess,
  fetchAuditDiscoveryResource,
} from "@/server/lib/audit/discovery";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analyzeAiCrawlerAccess", () => {
  it("reports search/retrieval policies without scoring training-only bots", () => {
    const access = analyzeAiCrawlerAccess(
      "https://example.com",
      `User-agent: OAI-SearchBot
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: *
Allow: /`,
    );

    expect(
      access.find((entry) => entry.userAgent === "OAI-SearchBot"),
    ).toMatchObject({ allowed: false, kind: "ai-search" });
    expect(
      access.find((entry) => entry.userAgent === "Googlebot"),
    ).toMatchObject({ allowed: true, kind: "search" });
    expect(access.some((entry) => entry.userAgent === "GPTBot")).toBe(false);
  });

  it("treats a missing robots file as allowed", () => {
    expect(
      analyzeAiCrawlerAccess("https://example.com", null).every(
        (entry) => entry.allowed,
      ),
    ).toBe(true);
  });
});

describe("fetchAuditDiscoveryResource", () => {
  it("blocks a private redirect before sending the redirected request", async () => {
    const fetchMock = vi.fn(async () =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAuditDiscoveryResource("https://93.184.216.34/llms.txt", {
        headers: { "User-Agent": "OpenSEO-Audit/1.0" },
      }),
    ).rejects.toMatchObject({ code: "CRAWL_TARGET_BLOCKED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect hostname whose DNS answer is private", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
        const type = new URL(url).searchParams.get("type");
        return new Response(
          JSON.stringify({
            Status: 0,
            Answer: type === "A" ? [{ type: 1, data: "169.254.169.254" }] : [],
          }),
          { status: 200 },
        );
      }
      if (url === "https://93.184.216.34/llms.txt") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://redirect.example/latest/meta-data" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAuditDiscoveryResource("https://93.184.216.34/llms.txt", {
        headers: { "User-Agent": "OpenSEO-Audit/1.0" },
      }),
    ).rejects.toMatchObject({ code: "CRAWL_TARGET_BLOCKED" });
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input instanceof Request ? input.url : input).startsWith(
          "http://redirect.example/",
        ),
      ),
    ).toBe(false);
  });
});
