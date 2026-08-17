import { describe, expect, it } from "vitest";
import type { ReportSnapshot } from "@/types/schemas/reports";
import {
  DEFAULT_REPORT_BRANDING,
  renderReportHtml,
  resolveReportBranding,
} from "./reportPresentation";

const snapshot: ReportSnapshot = {
  version: 1,
  generatedAt: "2026-08-17T00:00:00.000Z",
  project: {
    id: "project-1",
    name: '<script>alert("x")</script>',
    domain: "acme.test",
  },
  period: { start: "2026-07-01", end: "2026-07-31" },
  comparisonPeriod: { start: "2026-06-01", end: "2026-06-30" },
  sections: [],
  omissions: [{ key: "ga4", reason: "not_configured" }],
  evidence: [],
};

const branding = {
  ...DEFAULT_REPORT_BRANDING,
  logoUrl: "https://cdn.example.com/logo.png",
};

describe("report presentation", () => {
  it("escapes project data instead of emitting it as markup", () => {
    const html = renderReportHtml({ snapshot, branding });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps remote assets out of the PDF document", () => {
    expect(renderReportHtml({ snapshot, branding })).not.toContain(
      "cdn.example.com",
    );
    expect(
      renderReportHtml({ snapshot, branding, allowRemoteAssets: true }),
    ).toContain("cdn.example.com");
  });

  it("falls back to product branding for unset profile fields", () => {
    expect(resolveReportBranding({ brandName: "Acme SEO" })).toEqual({
      ...DEFAULT_REPORT_BRANDING,
      brandName: "Acme SEO",
    });
  });
});
