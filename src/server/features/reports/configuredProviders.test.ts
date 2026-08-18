import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ReportSnapshot } from "@/types/schemas/reports";
import {
  createGotenbergReportPdfRenderer,
  createResendReportEmailProvider,
} from "./configuredProviders";

const snapshot: ReportSnapshot = {
  version: 1,
  generatedAt: "2026-08-17T00:00:00.000Z",
  project: { id: "project-1", name: "Client Site", domain: "example.com" },
  period: {
    start: "2026-07-17T00:00:00.000Z",
    end: "2026-08-17T00:00:00.000Z",
  },
  branding: {
    brandName: "OpenSEO",
    logoUrl: null,
    primaryColor: "#2563eb",
    accentColor: "#14b8a6",
  },
  sections: [{ key: "audit", data: { pagesCrawled: 10 } }],
  omissions: [],
};

describe("Gotenberg report PDF provider", () => {
  it("renders deterministic HTML and stores a verified PDF in R2", async () => {
    const put = vi.fn().mockResolvedValue({});
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("%PDF-1.7\nreport", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    const renderer = createGotenbergReportPdfRenderer({
      renderUrl: "https://renderer.example/",
      bearerToken: "private-token",
      bucket: { put },
      fetcher,
    });

    const result = await renderer.render({
      runId: "run-1",
      snapshot,
      idempotencyKey: "report:run-1:pdf",
    });

    expect(renderer.configured).toBe(true);
    expect(result).toMatchObject({
      status: "rendered",
      artifact: {
        storageKey: "reports/run-1/report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 15,
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://renderer.example/forms/chromium/convert/html");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer private-token",
    );
    const form = init?.body;
    if (!(form instanceof FormData)) throw new Error("Expected FormData");
    expect(form.get("printBackground")).toBe("true");
    const file = form.get("files");
    if (!(file instanceof File)) throw new Error("Expected report HTML file");
    expect(file.name).toBe("index.html");
    expect(await file.text()).toContain("Client Site");
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]?.[0]).toBe("reports/run-1/report.pdf");
  });

  it("rejects a non-PDF renderer response", async () => {
    const renderer = createGotenbergReportPdfRenderer({
      renderUrl: "https://renderer.example",
      bucket: {
        put: vi.fn(),
      },
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("error")),
    });
    await expect(
      renderer.render({
        runId: "run-1",
        snapshot,
        idempotencyKey: "report:run-1:pdf",
      }),
    ).resolves.toEqual({
      status: "failed",
      error: "PDF renderer returned an invalid document.",
    });
  });
});

describe("Resend report email provider", () => {
  it("sends the stored PDF with an idempotency key", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: "email-123" }));
    const provider = createResendReportEmailProvider({
      apiKey: "resend-secret",
      from: "OpenSEO <reports@example.com>",
      replyTo: "team@example.com",
      bucket: {
        get: vi.fn().mockResolvedValue({
          arrayBuffer: () =>
            Promise.resolve(new TextEncoder().encode("%PDF-1.7").buffer),
        }),
      },
      fetcher,
    });

    await expect(
      provider.send({
        to: { email: "owner@example.com", name: 'Owner "Name"\r\nBcc' },
        subject: "Monthly report",
        snapshot,
        pdfStorageKey: "reports/run-1/report.pdf",
        idempotencyKey: "report:run-1:email:delivery-1",
      }),
    ).resolves.toEqual({ status: "sent", providerMessageId: "email-123" });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer resend-secret");
    expect(headers.get("idempotency-key")).toBe(
      "report:run-1:email:delivery-1",
    );
    if (typeof init?.body !== "string") {
      throw new Error("Expected a JSON request body");
    }
    const parsedBody: unknown = JSON.parse(init.body);
    const body = z
      .object({
        to: z.array(z.string()),
        reply_to: z.string(),
        attachments: z.array(
          z.object({ filename: z.string(), content: z.string() }),
        ),
      })
      .parse(parsedBody);
    expect(body.to).toEqual(['"Owner  Name   Bcc" <owner@example.com>']);
    expect(body.reply_to).toBe("team@example.com");
    expect(body.attachments[0]?.filename).toBe("client-site-report.pdf");
    expect(body.attachments[0]?.content).toBe(
      Buffer.from("%PDF-1.7").toString("base64"),
    );
  });

  it("stays explicitly unconfigured without credentials", async () => {
    const provider = createResendReportEmailProvider({});
    expect(provider.configured).toBe(false);
    await expect(
      provider.send({
        to: { email: "owner@example.com", name: null },
        subject: "Report",
        snapshot,
        pdfStorageKey: null,
        idempotencyKey: "report:run-1:email:delivery-1",
      }),
    ).resolves.toEqual({ status: "unconfigured" });
  });
});
