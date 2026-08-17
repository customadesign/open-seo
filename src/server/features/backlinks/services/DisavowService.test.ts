import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/features/backlinks/repositories/DisavowRepository", () => ({
  DisavowRepository: {
    list: vi.fn(),
    saveManual: vi.fn(),
    importMany: vi.fn(),
    remove: vi.fn(),
    listExportable: vi.fn(),
    markExported: vi.fn(),
  },
}));

import {
  buildGoogleDisavowTxt,
  normalizeDisavowValue,
  parseGoogleDisavowTxt,
  parseSemrushDisavowCsv,
} from "./DisavowService";

describe("DisavowService normalization", () => {
  it("normalizes domains without allowing a path", () => {
    expect(normalizeDisavowValue("domain", "domain:Example.COM.")).toBe(
      "example.com",
    );
    expect(() => normalizeDisavowValue("domain", "example.com/path")).toThrow(
      "Invalid disavow domain",
    );
  });

  it("normalizes absolute URLs and removes fragments", () => {
    expect(
      normalizeDisavowValue(
        "url",
        "HTTPS://Example.COM/comments/paid?ref=1#section",
      ),
    ).toBe("https://example.com/comments/paid?ref=1");
  });
});

describe("disavow imports", () => {
  it("imports SEMrush domain decisions without inventing a risk score", () => {
    const rows = parseSemrushDisavowCsv(
      [
        "Referring Domain,Status,Comments,Backlinks",
        "house-rent.info,Exported,Reviewed in SEMrush,12",
        "example.com,Whitelist,Partner,3",
      ].join("\n"),
    );
    expect(rows).toEqual([
      {
        entryType: "domain",
        value: "house-rent.info",
        status: "exported",
        comments: "Reviewed in SEMrush",
        source: "semrush_csv",
        linkCount: 12,
      },
      {
        entryType: "domain",
        value: "example.com",
        status: "kept",
        comments: "Partner",
        source: "semrush_csv",
        linkCount: 3,
      },
    ]);
  });

  it("imports Google comments and treats the current file as exported", () => {
    const rows = parseGoogleDisavowTxt(
      "# prior analyst note\ndomain:bad.example\nhttps://links.example/spam#fragment\n",
    );
    expect(rows).toEqual([
      {
        entryType: "domain",
        value: "bad.example",
        status: "exported",
        comments: "prior analyst note",
        source: "google_txt",
        linkCount: 0,
      },
      {
        entryType: "url",
        value: "https://links.example/spam",
        status: "exported",
        comments: null,
        source: "google_txt",
        linkCount: 0,
      },
    ]);
  });
});

describe("Google disavow export", () => {
  it("is deterministic, sorted, and contains only domain or absolute URL entries", () => {
    const entries = [
      {
        entryType: "url",
        value: "https://z.example/link",
        comments: null,
        linkCount: 0,
      },
      {
        entryType: "domain",
        value: "b.example",
        comments: "manual review",
        linkCount: 7,
      },
      {
        entryType: "domain",
        value: "a.example",
        comments: null,
        linkCount: 0,
      },
    ] as const;
    const content = buildGoogleDisavowTxt([...entries]);
    expect(content).toBe(
      [
        "# OpenSEO disavow export",
        "# Review carefully before manually uploading to Google Search Console",
        "",
        "domain:a.example",
        "# manual review",
        "# observed links: 7",
        "domain:b.example",
        "https://z.example/link",
        "",
      ].join("\n"),
    );
    expect(buildGoogleDisavowTxt([...entries])).toBe(content);
  });
});
