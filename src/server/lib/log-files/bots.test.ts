import { describe, expect, it } from "vitest";
import {
  confirmBotByReverseDns,
  identifyClaimedBot,
  verifyClaimedBot,
} from "./bots";

describe("identifyClaimedBot", () => {
  it("maps known search and AI crawler user-agents", () => {
    expect(
      identifyClaimedBot(
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      ),
    ).toBe("googlebot");
    expect(identifyClaimedBot("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe(
      "bingbot",
    );
    expect(identifyClaimedBot("OAI-SearchBot/1.0")).toBe("oai-searchbot");
    expect(identifyClaimedBot("Chrome/120")).toBeNull();
  });
});

describe("verifyClaimedBot", () => {
  it("does not trust a Googlebot user-agent from an unmatched IP", async () => {
    expect(await verifyClaimedBot("203.0.113.10", "googlebot")).toBe(
      "unverified",
    );
  });

  it("verifies a published Googlebot prefix without DNS", async () => {
    expect(await verifyClaimedBot("66.249.66.1", "googlebot")).toBe("verified");
  });

  it("accepts forward-confirmed reverse DNS", async () => {
    const ok = await confirmBotByReverseDns("66.249.66.1", "googlebot", {
      reverse: async () => "crawl-66-249-66-1.googlebot.com",
      forward: async () => ["66.249.66.1"],
    });
    expect(ok).toBe(true);
  });

  it("rejects reverse DNS that does not forward-confirm", async () => {
    const ok = await confirmBotByReverseDns("203.0.113.10", "googlebot", {
      reverse: async () => "crawl-66-249-66-1.googlebot.com",
      forward: async () => ["66.249.66.1"],
    });
    expect(ok).toBe(false);
  });
});
