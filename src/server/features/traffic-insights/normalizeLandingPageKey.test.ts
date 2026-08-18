import { describe, expect, it } from "vitest";
import { normalizeLandingPageKey } from "./normalizeLandingPageKey";

describe("normalizeLandingPageKey", () => {
  it("treats a trailing slash as the same page", () => {
    expect(normalizeLandingPageKey("https://example.com/blog/")).toBe(
      "example.com/blog",
    );
    expect(normalizeLandingPageKey("https://example.com/blog")).toBe(
      "example.com/blog",
    );
  });

  it("ignores http versus https", () => {
    expect(normalizeLandingPageKey("http://example.com/pricing")).toBe(
      normalizeLandingPageKey("https://example.com/pricing"),
    );
  });

  it("treats www and the bare host as the same page", () => {
    expect(normalizeLandingPageKey("https://www.example.com/about")).toBe(
      "example.com/about",
    );
    expect(normalizeLandingPageKey("https://example.com/about")).toBe(
      "example.com/about",
    );
  });

  it("drops query strings from the join key", () => {
    expect(
      normalizeLandingPageKey("https://example.com/offer?utm_source=gsc"),
    ).toBe("example.com/offer");
  });

  it("matches host and path case-insensitively", () => {
    expect(normalizeLandingPageKey("https://EXAMPLE.com/High-Value")).toBe(
      "example.com/high-value",
    );
  });

  it("joins a GA4 host and path onto a full GSC URL", () => {
    expect(
      normalizeLandingPageKey("/High-Value/?utm=1", "www.Example.com"),
    ).toBe("example.com/high-value");
    expect(
      normalizeLandingPageKey("https://example.com/High-Value?ref=gsc"),
    ).toBe("example.com/high-value");
  });

  it("returns null for empty, unset, or path-only values without a host", () => {
    expect(normalizeLandingPageKey("")).toBeNull();
    expect(normalizeLandingPageKey("(not set)")).toBeNull();
    expect(normalizeLandingPageKey("/blog")).toBeNull();
  });
});
