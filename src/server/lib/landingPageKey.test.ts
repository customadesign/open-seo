import { describe, expect, it } from "vitest";
import { landingPageKey, matchLandingPageKey } from "./landingPageKey";

describe("landingPageKey", () => {
  it("treats a trailing slash as the same page", () => {
    expect(landingPageKey("https://example.com/blog/")).toBe(
      "example.com/blog",
    );
    expect(landingPageKey("https://example.com/blog")).toBe("example.com/blog");
  });

  it("ignores http versus https", () => {
    expect(landingPageKey("http://example.com/pricing")).toBe(
      landingPageKey("https://example.com/pricing"),
    );
  });

  it("treats www and the bare host as the same page", () => {
    expect(landingPageKey("https://www.example.com/about")).toBe(
      "example.com/about",
    );
    expect(landingPageKey("https://example.com/about")).toBe(
      "example.com/about",
    );
  });

  it("drops query strings so campaign and product parameters group by path", () => {
    expect(landingPageKey("https://example.com/offer?utm_source=gsc")).toBe(
      "example.com/offer",
    );
    expect(landingPageKey("https://example.com/offer?product_id=1")).toBe(
      landingPageKey("https://example.com/offer?product_id=2"),
    );
  });

  it("lowercases the host and preserves path casing", () => {
    expect(landingPageKey("https://EXAMPLE.com/High-Value")).toBe(
      "example.com/High-Value",
    );
    expect(landingPageKey("https://example.com/Services")).not.toBe(
      landingPageKey("https://example.com/services"),
    );
  });

  it("joins a GA4 host and path onto a full GSC URL", () => {
    expect(landingPageKey("/High-Value/?utm=1", "www.Example.com")).toBe(
      "example.com/High-Value",
    );
    expect(landingPageKey("https://example.com/High-Value?ref=gsc")).toBe(
      "example.com/High-Value",
    );
  });

  it("returns null for empty, placeholder, or path-only values without a host", () => {
    expect(landingPageKey("")).toBeNull();
    expect(landingPageKey("(not set)")).toBeNull();
    expect(landingPageKey("(other)")).toBeNull();
    expect(landingPageKey("/blog")).toBeNull();
  });
});

describe("matchLandingPageKey", () => {
  it("returns the exact key when it exists even if a case variant is also present", () => {
    expect(
      matchLandingPageKey(
        ["example.com/Services", "example.com/services"],
        "example.com/services",
      ),
    ).toBe("example.com/services");
  });

  it("falls back to a unique case-insensitive key when the exact key is absent", () => {
    expect(
      matchLandingPageKey(["example.com/High-Value"], "example.com/high-value"),
    ).toBe("example.com/High-Value");
  });

  it("does not pick a case-insensitive match when more than one exists", () => {
    expect(
      matchLandingPageKey(
        ["example.com/Services", "example.com/services"],
        "example.com/SERVICES",
      ),
    ).toBeUndefined();
  });
});
