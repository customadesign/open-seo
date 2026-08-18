import { describe, expect, it } from "vitest";
import {
  isDisavowCandidate,
  isExportableDisavowStatus,
  ipv4Subnet,
  scoreBacklinkToxicity,
  scoreDomainToxicity,
  scoreProfileToxicity,
  selectExportableAuditRows,
} from "./backlink-toxicity";

describe("scoreBacklinkToxicity", () => {
  it("scores a clean editorial link as non-toxic with no markers", () => {
    const result = scoreBacklinkToxicity({
      domainFrom: "nytimes.com",
      anchor: "OpenSEO",
      domainFromRank: 72,
      spamScore: 4,
      pageLanguage: "en",
      targetLanguage: "en",
      targetHost: "openseo.com",
    });
    expect(result).toMatchObject({
      score: 0,
      classification: "non_toxic",
      verdict: "low",
      markers: [],
    });
  });

  it("flags firebaseapp and web.app hosts as free-subdomain spam", () => {
    const result = scoreBacklinkToxicity({
      domainFrom: "promo-123.firebaseapp.com",
      domainFromRank: 2,
      spamScore: 8,
    });
    expect(result.classification).toBe("toxic");
    expect(result.markers.map((marker) => marker.code)).toEqual(
      expect.arrayContaining(["free_subdomain", "low_authority"]),
    );
    expect(scoreBacklinkToxicity({ domainFrom: "x.web.app" }).markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "free_subdomain" }),
      ]),
    );
  });

  it("adds a spam-tld marker for .xyz and .gq hosts", () => {
    const result = scoreBacklinkToxicity({
      domainFrom: "cheap-links.xyz",
      tldFrom: "xyz",
    });
    expect(result.markers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "spam_tld" })]),
    );
  });

  it("treats exact-match commercial and adult/pharma/gambling anchors as toxic", () => {
    expect(
      scoreBacklinkToxicity({
        domainFrom: "blog.example",
        anchor: "Buy cheap backlinks",
        targetHost: "acme.com",
      }).markers.map((marker) => marker.code),
    ).toContain("exact_match_commercial_anchor");
    expect(
      scoreBacklinkToxicity({
        domainFrom: "blog.example",
        anchor: "best cialis online",
      }).markers.map((marker) => marker.code),
    ).toEqual(expect.arrayContaining(["pharma_anchor"]));
    expect(
      scoreBacklinkToxicity({
        domainFrom: "blog.example",
        anchor: "online casino jackpot",
      }).markers.map((marker) => marker.code),
    ).toContain("gambling_anchor");
  });

  it("records a language mismatch against the project language", () => {
    const result = scoreBacklinkToxicity({
      domainFrom: "news.example",
      pageLanguage: "ru",
      targetLanguage: "en",
    });
    expect(result.markers).toEqual([
      expect.objectContaining({
        code: "language_mismatch",
        detail: "page=ru, target=en",
      }),
    ]);
  });

  it("is deterministic for the same signals", () => {
    const input = {
      domainFrom: "spam.firebaseapp.com",
      anchor: "buy cheap cialis",
      domainFromRank: 1,
      spamScore: 80,
      semanticLocation: "footer",
      linksCount: 40,
      pageLanguage: "vi",
      targetLanguage: "en",
    };
    expect(scoreBacklinkToxicity(input)).toEqual(scoreBacklinkToxicity(input));
  });
});

describe("scoreDomainToxicity", () => {
  it("adds volume, subnet, and velocity markers on the domain roll-up", () => {
    const result = scoreDomainToxicity({
      domain: "linkfarm.example",
      backlinkCount: 60,
      recentLinkCount: 14,
      subnetDomainCount: 8,
      rank: 40,
      spamScore: 5,
    });
    expect(result.markers.map((marker) => marker.code)).toEqual(
      expect.arrayContaining([
        "high_links_per_domain",
        "subnet_cluster",
        "velocity_spike",
      ]),
    );
    expect(result.classification).toBe("toxic");
  });
});

describe("scoreProfileToxicity", () => {
  it("calls a profile high when toxic domains are 16.8% of referring domains", () => {
    const result = scoreProfileToxicity({
      domainScores: Array.from({ length: 173 }, () => 10).concat(
        Array.from({ length: 29 }, () => 80),
      ),
      toxicDomainCount: 29,
      potentiallyToxicDomainCount: 0,
      domainCount: 173,
    });
    expect(result.verdict).toBe("high");
  });
});

describe("disavow candidate and export gates", () => {
  it("never treats a kept domain as a disavow candidate", () => {
    expect(
      isDisavowCandidate({ classification: "toxic", status: "kept" }),
    ).toBe(false);
  });

  it("keeps a non-toxic row out of the generated disavow file", () => {
    const rows = selectExportableAuditRows([
      {
        domain: "partner.example",
        classification: "non_toxic" as const,
        status: "kept" as const,
      },
      {
        domain: "keep-me.example",
        classification: "toxic" as const,
        status: "kept" as const,
      },
      {
        domain: "ok.example",
        classification: "non_toxic" as const,
        status: "pending" as const,
      },
      {
        domain: "spam.example",
        classification: "toxic" as const,
        status: "disavowed" as const,
      },
    ]);
    expect(rows.map((row) => row.domain)).toEqual(["spam.example"]);
    expect(isExportableDisavowStatus("kept")).toBe(false);
  });
});

describe("ipv4Subnet", () => {
  it("groups IPv4 addresses on a /24", () => {
    expect(ipv4Subnet("203.0.113.44")).toBe("203.0.113.0/24");
    expect(ipv4Subnet("not-an-ip")).toBeNull();
  });
});
