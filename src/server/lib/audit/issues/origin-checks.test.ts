import { afterEach, describe, expect, it, vi } from "vitest";
import { runOriginVariantChecks } from "@/server/lib/audit/issues/origin-checks";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runOriginVariantChecks", () => {
  it("flags www and apex both returning 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.resolve(new Response("ok", { status: 200 }))),
    );
    const issues = await runOriginVariantChecks({
      startUrl: "https://example.com/blog",
    });
    expect(issues.map((issue) => issue.issueType)).toContain(
      "www-resolve-issue",
    );
  });

  it("flags an HTTP homepage that serves 200 instead of redirecting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.startsWith("http://")) {
          return new Response("ok", { status: 200 });
        }
        return new Response(null, {
          status: 301,
          headers: { location: "https://example.com/" },
        });
      }),
    );
    const issues = await runOriginVariantChecks({
      startUrl: "https://example.com/",
    });
    expect(issues.map((issue) => issue.issueType)).toContain(
      "http-homepage-not-secure",
    );
  });

  it("does not invent a WWW issue when the variant is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("www.")) throw new Error("getaddrinfo ENOTFOUND");
        return new Response("ok", { status: 200 });
      }),
    );
    const issues = await runOriginVariantChecks({
      startUrl: "https://example.com/",
    });
    expect(issues.map((issue) => issue.issueType)).not.toContain(
      "www-resolve-issue",
    );
  });
});
