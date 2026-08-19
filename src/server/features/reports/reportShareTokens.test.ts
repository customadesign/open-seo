import { describe, expect, it } from "vitest";
import {
  createReportShareToken,
  hashReportShareToken,
  isReportShareLinkUsable,
  SHARE_TOKEN_PATTERN,
} from "./reportShareTokens";

const now = new Date("2026-08-17T00:00:00.000Z");

describe("report share tokens", () => {
  it("issues a URL-safe token stored only as its hash", async () => {
    const { token, tokenHash } = await createReportShareToken();
    expect(SHARE_TOKEN_PATTERN.test(token)).toBe(true);
    expect(tokenHash).toBe(await hashReportShareToken(token));
    expect(tokenHash).not.toContain(token);
  });

  it("refuses expired and revoked links", () => {
    expect(
      isReportShareLinkUsable(
        { expiresAt: "2026-08-18T00:00:00.000Z", revokedAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      isReportShareLinkUsable(
        { expiresAt: "2026-08-16T00:00:00.000Z", revokedAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isReportShareLinkUsable(
        {
          expiresAt: "2026-08-18T00:00:00.000Z",
          revokedAt: "2026-08-16T00:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
  });
});
