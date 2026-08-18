import { describe, expect, it } from "vitest";
import { analyzeAiCrawlerAccess } from "@/server/lib/audit/discovery";

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
