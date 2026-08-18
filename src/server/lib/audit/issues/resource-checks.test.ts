import { describe, expect, it } from "vitest";
import {
  reportAssetProbes,
  reportCanonicalProbes,
  reportExternalLinkProbes,
  reportHreflangTargetProbes,
  reportImageProbes,
} from "@/server/lib/audit/issues/resource-checks";
import type { ResourceProbeStatus } from "@/server/lib/audit/resource-probe";

function ok(statusCode: number): ResourceProbeStatus {
  return {
    kind: "ok",
    statusCode,
    headers: {
      contentEncoding: "gzip",
      cacheControl: "max-age=86400",
      expires: null,
      contentType: "text/plain",
      contentLength: 100,
      strictTransportSecurity: null,
    },
  };
}

describe("reportExternalLinkProbes", () => {
  it("flags 4xx/5xx as broken and 403 as its own issue", () => {
    const links = [
      {
        sourcePageId: "p1",
        sourceUrl: "https://example.com/a",
        targetUrl: "https://gone.example/x",
      },
      {
        sourcePageId: "p1",
        sourceUrl: "https://example.com/a",
        targetUrl: "https://private.example/x",
      },
    ];
    const probes = new Map<string, ResourceProbeStatus>([
      ["https://gone.example/x", ok(404)],
      ["https://private.example/x", ok(403)],
    ]);
    const types = reportExternalLinkProbes(links, probes).map(
      (issue) => issue.issueType,
    );
    expect(types).toEqual(["broken-external-link", "external-link-403"]);
  });

  it("ignores skipped and live targets", () => {
    const issues = reportExternalLinkProbes(
      [
        {
          sourcePageId: "p1",
          sourceUrl: "https://example.com/a",
          targetUrl: "https://ok.example/",
        },
        {
          sourcePageId: "p1",
          sourceUrl: "https://example.com/a",
          targetUrl: "https://capped.example/",
        },
      ],
      new Map([
        ["https://ok.example/", ok(200)],
        ["https://capped.example/", { kind: "skipped", reason: "cap" }],
      ]),
    );
    expect(issues).toEqual([]);
  });
});

describe("reportImageProbes", () => {
  it("classifies internal vs external broken images", () => {
    const issues = reportImageProbes({
      origin: "https://example.com",
      pages: [
        {
          id: "p1",
          url: "https://example.com/a",
          imageSrcs: [
            "https://example.com/missing.png",
            "https://cdn.example/gone.jpg",
          ],
        },
      ],
      probes: new Map([
        ["https://example.com/missing.png", ok(404)],
        ["https://cdn.example/gone.jpg", ok(500)],
      ]),
    });
    expect(issues.map((issue) => issue.issueType)).toEqual([
      "broken-internal-image",
      "broken-external-image",
    ]);
  });
});

describe("reportAssetProbes", () => {
  it("flags broken, unminified, uncompressed, uncached, and oversized assets", () => {
    const prettyJs = "function x() {\n  return 1;\n}\n".repeat(80);
    const issues = reportAssetProbes({
      origin: "https://example.com",
      pages: [
        {
          id: "p1",
          url: "https://example.com/a",
          scriptUrls: [
            "https://example.com/app.js",
            "https://cdn.example/missing.js",
          ],
          stylesheetUrls: ["https://example.com/app.css"],
          inlineScriptBytes: 0,
          inlineStyleBytes: 0,
        },
      ],
      probes: new Map<string, ResourceProbeStatus>([
        [
          "https://example.com/app.js",
          {
            kind: "inspect",
            statusCode: 200,
            headers: {
              contentEncoding: "identity",
              cacheControl: null,
              expires: null,
              contentType: "text/javascript",
              contentLength: prettyJs.length,
              strictTransportSecurity: null,
            },
            body: prettyJs,
            bodyBytes: prettyJs.length,
          },
        ],
        ["https://cdn.example/missing.js", ok(404)],
        [
          "https://example.com/app.css",
          {
            kind: "inspect",
            statusCode: 200,
            headers: {
              contentEncoding: "gzip",
              cacheControl: "max-age=3600",
              expires: null,
              contentType: "text/css",
              contentLength: 10,
              strictTransportSecurity: null,
            },
            body: "body{color:red}",
            bodyBytes: 10,
          },
        ],
      ]),
    });
    const types = issues.map((issue) => issue.issueType);
    expect(types).toEqual(
      expect.arrayContaining([
        "unminified-javascript",
        "uncompressed-javascript",
        "uncached-javascript",
        "broken-external-javascript",
      ]),
    );
  });
});

describe("reportCanonicalProbes", () => {
  it("uses the crawled status when the canonical was in the crawl", () => {
    const issues = reportCanonicalProbes({
      pages: [
        {
          id: "p1",
          url: "https://example.com/a",
          canonicalUrl: "https://example.com/gone",
          headerCanonicalUrl: null,
          statusByUrl: new Map([["https://example.com/gone", 404]]),
        },
      ],
      probes: new Map(),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].issueType).toBe("broken-canonical");
  });
});

describe("reportHreflangTargetProbes", () => {
  it("flags a missing href, a non-200 target, and a non-reciprocal pair", () => {
    const issues = reportHreflangTargetProbes({
      pages: [
        {
          id: "p1",
          url: "https://example.com/en",
          links: [
            { lang: "en", href: null },
            { lang: "de", href: "https://example.com/de" },
            { lang: "fr", href: "https://example.com/fr" },
          ],
          statusByUrl: new Map([
            ["https://example.com/de", 404],
            ["https://example.com/fr", 200],
          ]),
          hreflangByUrl: new Map([
            [
              "https://example.com/fr",
              [{ lang: "fr", href: "https://example.com/fr" }],
            ],
          ]),
        },
      ],
      probes: new Map(),
    });
    const reasons = issues.map((issue) => issue.details?.reason);
    expect(reasons).toEqual(
      expect.arrayContaining(["missing-href", "non-200", "not-reciprocal"]),
    );
  });
});
