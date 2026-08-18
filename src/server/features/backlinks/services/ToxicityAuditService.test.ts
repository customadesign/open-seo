import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock(
  "@/server/features/backlinks/repositories/ToxicityAuditRepository",
  () => ({
    ToxicityAuditRepository: {
      getLatest: vi.fn(),
      insertAudit: vi.fn(),
      insertDomains: vi.fn(),
      pruneOlderThan: vi.fn(),
      getPrevious: vi.fn(),
      listDomains: vi.fn(),
      listLatestDomainsByProject: vi.fn(),
    },
  }),
);

import { createToxicityAuditService } from "./ToxicityAuditService";

const referringDomains = vi.fn();
const rows = vi.fn();
const getLatest = vi.fn();
const insertAudit = vi.fn();
const insertDomains = vi.fn();
const pruneOlderThan = vi.fn();
const list = vi.fn();
const getByValue = vi.fn();
const saveManual = vi.fn();

const billingCustomer = {
  organizationId: "org_1",
  userId: "user_1",
  userEmail: "owner@example.com",
};

const service = createToxicityAuditService({
  createClient: () => ({
    backlinks: { referringDomains, rows },
  }),
  audits: {
    getLatest,
    insertAudit,
    insertDomains,
    pruneOlderThan,
    getPrevious: vi.fn(),
    listDomains: vi.fn(),
    listLatestDomainsByProject: vi.fn(),
  },
  disavow: {
    list,
    getByValue,
    saveManual,
    importMany: vi.fn(),
    remove: vi.fn(),
    listExportable: vi.fn(),
    markExported: vi.fn(),
  },
});

beforeEach(() => {
  referringDomains.mockResolvedValue({
    items: [
      {
        domain: "spam.firebaseapp.com",
        backlinks: 12,
        rank: 3,
        backlinks_spam_score: 70,
        broken_backlinks: 0,
      },
      {
        domain: "nytimes.com",
        backlinks: 2,
        rank: 80,
        backlinks_spam_score: 2,
        broken_backlinks: 0,
      },
    ],
    totalCount: 2,
  });
  rows.mockResolvedValue({
    items: [
      {
        domain_from: "spam.firebaseapp.com",
        anchor: "buy cheap cialis",
        domain_from_rank: 3,
        backlink_spam_score: 70,
        first_seen: new Date().toISOString(),
        is_broken: false,
        semantic_location: "footer",
        links_count: 30,
        page_from_language: "ru",
        tld_from: "com",
      },
    ],
    totalCount: 1,
  });
  getLatest.mockResolvedValue(null);
  insertAudit.mockImplementation(async (values: { id: string }) => values);
  insertDomains.mockResolvedValue(undefined);
  pruneOlderThan.mockResolvedValue(undefined);
  list.mockResolvedValue([]);
  getByValue.mockResolvedValue(null);
  saveManual.mockResolvedValue({ id: "entry_1" });
});

describe("ToxicityAuditService.runAudit", () => {
  it("scores referring domains and persists a profile verdict", async () => {
    const result = await service.runAudit({
      projectId: "project_1",
      target: "example.com",
      languageCode: "en",
      billingCustomer,
    });
    const toxic = result.domains.find(
      (row) => row.domain === "spam.firebaseapp.com",
    );
    expect(toxic?.classification).toBe("toxic");
    expect(toxic?.markers.map((marker) => marker.code)).toEqual(
      expect.arrayContaining(["free_subdomain"]),
    );
    expect(result.toxicCount).toBeGreaterThan(0);
    expect(insertAudit).toHaveBeenCalled();
    expect(insertDomains).toHaveBeenCalled();
  });

  it("does not re-surface a kept domain as a disavow candidate after a new audit", async () => {
    list.mockResolvedValue([
      {
        entryType: "domain",
        value: "spam.firebaseapp.com",
        status: "kept",
      },
    ]);
    const result = await service.runAudit({
      projectId: "project_1",
      target: "example.com",
      languageCode: "en",
      billingCustomer,
    });
    const toxic = result.domains.find(
      (row) => row.domain === "spam.firebaseapp.com",
    );
    expect(toxic?.classification).toBe("toxic");
    expect(toxic?.isWhitelisted).toBe(true);
    expect(toxic?.isDisavowCandidate).toBe(false);
  });

  it("tracks new and lost referring domains against the previous audit", async () => {
    getLatest.mockResolvedValue({
      audit: { id: "old", createdAt: "2026-01-01T00:00:00.000Z" },
      domains: [
        {
          domain: "gone.example",
          score: 80,
          verdict: "high",
          classification: "toxic",
          backlinkCount: 4,
          brokenBacklinkCount: 0,
          rank: 2,
          spamScore: 60,
          isNew: false,
          isLost: false,
          isBroken: false,
          markersJson: "[]",
        },
      ],
    });
    const result = await service.runAudit({
      projectId: "project_1",
      target: "example.com",
      languageCode: "en",
      billingCustomer,
    });
    expect(result.lostDomainCount).toBe(1);
    expect(
      result.domains.some((row) => row.domain === "gone.example" && row.isLost),
    ).toBe(true);
    expect(
      result.domains.some(
        (row) => row.domain === "spam.firebaseapp.com" && row.isNew,
      ),
    ).toBe(true);
  });
});

describe("ToxicityAuditService workflow", () => {
  it("refuses to move a whitelisted domain to disavow", async () => {
    getByValue.mockResolvedValue({ status: "kept" });
    await expect(
      service.moveToDisavow("project_1", "spam.firebaseapp.com"),
    ).rejects.toThrow("Whitelisted domains cannot be moved to disavow");
    expect(saveManual).not.toHaveBeenCalled();
  });

  it("refuses to move a non-toxic domain onto the disavow list", async () => {
    getLatest.mockResolvedValue({
      audit: { id: "a1" },
      domains: [
        {
          domain: "nytimes.com",
          classification: "non_toxic",
          backlinkCount: 2,
        },
      ],
    });
    await expect(
      service.moveToDisavow("project_1", "nytimes.com"),
    ).rejects.toThrow("Non-toxic domains cannot be moved to disavow");
  });
});

describe("ToxicityAuditService.previewExport", () => {
  it("never writes a whitelist, do-not-disavow, or non-toxic row", async () => {
    getLatest.mockResolvedValue({
      audit: {
        id: "a1",
        target: "example.com",
        scope: "domain",
        createdAt: "2026-08-18T00:00:00.000Z",
        profileScore: 40,
        profileVerdict: "medium",
        domainCount: 3,
        backlinkCount: 10,
        toxicCount: 1,
        potentiallyToxicCount: 0,
        nonToxicCount: 2,
        toxicPercent: 33,
        newDomainCount: 0,
        lostDomainCount: 0,
        brokenDomainCount: 0,
        newBacklinkCount: 0,
        lostBacklinkCount: 0,
        brokenBacklinkCount: 0,
        truncated: false,
      },
      domains: [
        domainRow("partner.example", "non_toxic", 8),
        domainRow("keep-me.example", "toxic", 82),
        domainRow("ok.example", "non_toxic", 4),
        domainRow("spam.example", "toxic", 88),
      ],
    });
    list.mockResolvedValue([
      { entryType: "domain", value: "partner.example", status: "kept" },
      { entryType: "domain", value: "keep-me.example", status: "kept" },
      { entryType: "domain", value: "ok.example", status: "pending" },
      { entryType: "domain", value: "spam.example", status: "disavowed" },
    ]);
    const preview = await service.previewExport("project_1");
    expect(preview.domains).toEqual(["spam.example"]);
    expect(preview.content).toContain("domain:spam.example");
    expect(preview.content).not.toContain("partner.example");
    expect(preview.content).not.toContain("keep-me.example");
    expect(preview.content).not.toContain("ok.example");
  });
});

function domainRow(
  domain: string,
  classification: "toxic" | "non_toxic",
  score: number,
) {
  return {
    domain,
    score,
    verdict: classification === "toxic" ? "high" : "low",
    classification,
    backlinkCount: 3,
    brokenBacklinkCount: 0,
    rank: 10,
    spamScore: score,
    isNew: false,
    isLost: false,
    isBroken: false,
    markersJson: "[]",
  };
}
