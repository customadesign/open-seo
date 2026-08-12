import { describe, expect, it } from "vitest";
import { reportBrandingSchema } from "@/types/schemas/reports";
import { DEFAULT_REPORT_BRANDING, resolveReportBranding } from "./branding";
import {
  calculateNextReportRun,
  calculatePreviousReportRun,
} from "./scheduling";
import {
  createReportShareToken,
  hashReportShareToken,
  isReportShareLinkUsable,
} from "./shareTokens";

describe("report scheduling", () => {
  it("preserves local wall-clock time across daylight saving changes", () => {
    expect(
      calculateNextReportRun(
        "weekly",
        "America/New_York",
        new Date("2026-03-01T14:00:00.000Z"),
      ),
    ).toBe("2026-03-08T13:00:00.000Z");
  });

  it("clamps a monthly run to the target month's last day", () => {
    expect(
      calculateNextReportRun(
        "monthly",
        "UTC",
        new Date("2026-01-31T09:30:00.000Z"),
      ),
    ).toBe("2026-02-28T09:30:00.000Z");
    expect(
      calculateNextReportRun(
        "monthly",
        "UTC",
        new Date("2026-02-28T09:30:00.000Z"),
      ),
    ).toBe("2026-03-31T09:30:00.000Z");
    expect(
      calculatePreviousReportRun(
        "monthly",
        "UTC",
        new Date("2026-03-31T09:30:00.000Z"),
      ),
    ).toBe("2026-02-28T09:30:00.000Z");
    expect(calculateNextReportRun("manual", "UTC", new Date())).toBeNull();
  });
});

describe("report branding precedence", () => {
  it("applies run overrides before template values before defaults", () => {
    expect(
      resolveReportBranding(
        {
          brandName: "Template Co",
          logoUrl: "https://example.com/template.svg",
          primaryColor: null,
          accentColor: "#222222",
        },
        {
          brandName: "Run Co",
          primaryColor: "#abcdef",
        },
      ),
    ).toEqual({
      brandName: "Run Co",
      logoUrl: "https://example.com/template.svg",
      primaryColor: "#abcdef",
      accentColor: "#222222",
    });
    expect(
      resolveReportBranding({
        brandName: null,
        logoUrl: null,
        primaryColor: null,
        accentColor: null,
      }),
    ).toEqual(DEFAULT_REPORT_BRANDING);
  });

  it("rejects executable logo URL schemes", () => {
    expect(
      reportBrandingSchema.safeParse({ logoUrl: "javascript:alert(1)" })
        .success,
    ).toBe(false);
  });
});

describe("report share tokens", () => {
  it("hashes tokens before persistence and enforces expiry and revocation", async () => {
    const created = await createReportShareToken();
    expect(created.token).not.toBe(created.tokenHash);
    expect(created.tokenHash).toBe(await hashReportShareToken(created.token));

    const now = new Date("2026-08-13T12:00:00.000Z");
    expect(
      isReportShareLinkUsable(
        { expiresAt: "2026-08-13T12:00:00.001Z", revokedAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      isReportShareLinkUsable(
        { expiresAt: "2026-08-13T12:00:00.000Z", revokedAt: null },
        now,
      ),
    ).toBe(false);
    expect(
      isReportShareLinkUsable(
        {
          expiresAt: "2026-08-14T12:00:00.000Z",
          revokedAt: "2026-08-13T11:00:00.000Z",
        },
        now,
      ),
    ).toBe(false);
  });
});
