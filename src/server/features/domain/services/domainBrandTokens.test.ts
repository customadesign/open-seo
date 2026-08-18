import { describe, expect, it } from "vitest";
import {
  deriveBrandTokensFromDomain,
  isBrandedKeyword,
  keywordMatchesBrandToken,
  normalizeBrandToken,
} from "@/server/features/domain/services/domainBrandTokens";

describe("deriveBrandTokensFromDomain", () => {
  it("uses the registrable label and hyphen parts of at least 3 characters", () => {
    expect(deriveBrandTokensFromDomain("blog.open-seo.com")).toEqual([
      "open",
      "open-seo",
      "seo",
    ]);
    expect(deriveBrandTokensFromDomain("www.example.com")).toEqual(["example"]);
  });
});

describe("keywordMatchesBrandToken", () => {
  it("matches a whole word or a collapsed brand phrase", () => {
    expect(keywordMatchesBrandToken("example reviews", "example")).toBe(true);
    expect(keywordMatchesBrandToken("open seo tool", "openseo")).toBe(true);
    expect(keywordMatchesBrandToken("examples of audits", "example")).toBe(
      false,
    );
  });
});

describe("isBrandedKeyword", () => {
  it("is branded when any resolved token matches", () => {
    expect(isBrandedKeyword("acme pricing", ["acme", "acme software"])).toBe(
      true,
    );
    expect(isBrandedKeyword("best crm software", ["acme"])).toBe(false);
  });
});

describe("normalizeBrandToken", () => {
  it("lowercases and rejects empty or overlong tokens", () => {
    expect(normalizeBrandToken(" Acme ")).toBe("acme");
    expect(normalizeBrandToken("a")).toBeNull();
    expect(normalizeBrandToken("x".repeat(65))).toBeNull();
  });
});
