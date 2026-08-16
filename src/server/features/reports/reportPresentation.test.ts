import { describe, expect, it } from "vitest";
import type { ReportSnapshot } from "@/types/schemas/reports";
import {
  escapeReportHtml,
  renderReportEmail,
  renderReportHtml,
} from "./reportPresentation";

const snapshot: ReportSnapshot = {
  version: 1,
  generatedAt: "2026-08-17T00:00:00.000Z",
  project: {
    id: "project-1",
    name: "Example <script>alert(1)</script>",
    domain: "example.com",
  },
  period: {
    start: "2026-07-17T00:00:00.000Z",
    end: "2026-08-17T00:00:00.000Z",
  },
  branding: {
    brandName: "Agency & Co",
    logoUrl: "https://internal.example/logo.svg",
    primaryColor: "#123456",
    accentColor: "#abcdef",
  },
  sections: [
    {
      key: "audit",
      data: {
        pagesCrawled: 12,
        issues: [
          {
            issueType: "bad <img src=x onerror=alert(1)>",
            affectedPages: 2,
          },
        ],
      },
    },
  ],
  omissions: [{ key: "ga4", reason: "not_configured" }],
};

describe("report presentation", () => {
  it("escapes every untrusted value and does not fetch the remote logo", () => {
    const html = renderReportHtml(snapshot);
    expect(html).toContain("Example &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("bad &lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain(snapshot.branding.logoUrl ?? "never");
    expect(html).toContain("Google Analytics:</strong> not connected");
  });

  it("builds concise HTML and plain-text email summaries", () => {
    const message = renderReportEmail({ snapshot, hasPdf: true });
    expect(message.html).toContain("Your PDF report is attached.");
    expect(message.html).toContain("Agency &amp; Co");
    expect(message.text).toContain("Included: Site health");
    expect(message.text).toContain("Google Analytics (not connected)");
  });

  it("escapes quotes and markup", () => {
    expect(escapeReportHtml(`<a title="x">O'Hare & Co</a>`)).toBe(
      "&lt;a title=&quot;x&quot;&gt;O&#039;Hare &amp; Co&lt;/a&gt;",
    );
  });
});
