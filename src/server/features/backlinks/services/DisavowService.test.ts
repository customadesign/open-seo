import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/features/backlinks/repositories/DisavowRepository", () => ({
  DisavowRepository: {
    list: vi.fn(),
    getByValue: vi.fn(),
    saveManual: vi.fn(),
    importMany: vi.fn(),
    remove: vi.fn(),
    listExportable: vi.fn(),
    markExported: vi.fn(),
  },
}));

import { DisavowRepository } from "@/server/features/backlinks/repositories/DisavowRepository";
import {
  buildGoogleDisavowTxt,
  DisavowService,
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

  // Substring matching read "Do not disavow" as a disavow decision, which put
  // deliberately kept domains into the Google file. Only "disavowed" and
  // "exported" reach that export, so every negated status must land elsewhere.
  it("never turns a negated SEMrush status into an exportable decision", () => {
    const rows = parseSemrushDisavowCsv(
      [
        "Referring Domain,Status",
        "keep-me.example,Do not disavow",
        "pending.example,Not exported",
        "partner.example,Whitelist - do not disavow",
        "later.example,Not yet exported",
        "safe.example,Never disavow",
        "unclear.example,",
        "spam.example,Disavowed",
        "sent.example,Exported",
        "outreach.example,Removal requested",
      ].join("\n"),
    );
    expect(
      Object.fromEntries(rows.map((row) => [row.value, row.status])),
    ).toEqual({
      "keep-me.example": "kept",
      "pending.example": "pending",
      "partner.example": "kept",
      "later.example": "pending",
      "safe.example": "kept",
      "unclear.example": "pending",
      "spam.example": "disavowed",
      "sent.example": "exported",
      "outreach.example": "removal_requested",
    });
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

  it("exports only the disavowed and exported rows the repository returns", async () => {
    vi.mocked(DisavowRepository.listExportable).mockResolvedValue([
      {
        id: "1",
        projectId: "p1",
        entryType: "domain",
        value: "spam.example",
        status: "disavowed",
        comments: null,
        source: "manual",
        linkCount: 3,
        exportedAt: null,
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z",
      },
    ]);
    vi.mocked(DisavowRepository.markExported).mockResolvedValue();
    const result = await DisavowService.exportGoogleTxt("p1");
    expect(result.content).toContain("domain:spam.example");
    expect(result.content).not.toContain("partner.example");
    expect(DisavowRepository.listExportable).toHaveBeenCalledWith("p1");
  });
});
