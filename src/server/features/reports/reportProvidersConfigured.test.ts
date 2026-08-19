import { describe, expect, it, vi } from "vitest";
import {
  MAX_EMAIL_REQUEST_BYTES,
  MAX_REPORT_PDF_BYTES,
} from "@/shared/report-delivery";
import type { ReportSnapshot } from "@/types/schemas/reports";
import { DEFAULT_REPORT_BRANDING } from "./reportPresentation";
import {
  createGotenbergReportPdfRenderer,
  createResendReportEmailProvider,
  type ReportFetcher,
} from "./reportProvidersConfigured";

const snapshot: ReportSnapshot = {
  version: 1,
  generatedAt: "2026-08-17T00:00:00.000Z",
  project: { id: "project-1", name: "Acme Co", domain: "acme.test" },
  period: { start: "2026-07-01", end: "2026-07-31" },
  comparisonPeriod: { start: "2026-06-01", end: "2026-06-30" },
  sections: [],
  omissions: [],
  evidence: [],
};

function pdfResponse(body: string, headers: Record<string, string> = {}) {
  return new Response(new Blob([body]), { status: 200, headers });
}

type FetchCall = { url: string; init: RequestInit };

/** Typed stand-in for `fetch` so assertions read the recorded request without
 * casting through `any`. */
function recordingFetcher(response: () => Response) {
  const calls: FetchCall[] = [];
  const fetcher: ReportFetcher = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(response());
  };
  return { calls, fetcher };
}

function bucket() {
  const put = vi.fn().mockResolvedValue(undefined);
  return { put, stub: { put } };
}

/** Both providers post a JSON string, so the recorded body has a byte size. */
function bodyBytes(init: RequestInit | undefined): number {
  const body = init?.body;
  if (typeof body !== "string") throw new Error("Expected a string body");
  return Buffer.byteLength(body);
}

const renderRequest = {
  runId: "run-1",
  snapshot,
  branding: DEFAULT_REPORT_BRANDING,
  commentary: [],
  idempotencyKey: "report:run-1:pdf",
};

describe("Gotenberg PDF renderer", () => {
  it("refuses a renderer endpoint that is not public HTTPS", () => {
    const renderer = createGotenbergReportPdfRenderer({
      renderUrl: "http://gotenberg.internal:3000",
      bearerToken: "secret-token",
      bucket: bucket().stub,
    });
    expect(renderer.configured).toBe(false);
  });

  it("refuses a public renderer with no bearer token", async () => {
    const renderer = createGotenbergReportPdfRenderer({
      renderUrl: "https://render.example.com",
      bearerToken: "  ",
      bucket: bucket().stub,
      fetcher: () => {
        throw new Error("must not call an unauthenticated renderer");
      },
    });
    expect(renderer.configured).toBe(false);
    await expect(renderer.render(renderRequest)).resolves.toEqual({
      status: "unconfigured",
    });
  });

  it("allows a tokenless loopback renderer for local development", () => {
    const renderer = createGotenbergReportPdfRenderer({
      renderUrl: "http://localhost:3000",
      bucket: bucket().stub,
    });
    expect(renderer.configured).toBe(true);
  });

  it("stores the PDF under a stable key with its checksum", async () => {
    const storage = bucket();
    const recorder = recordingFetcher(() => pdfResponse("%PDF-1.7 body"));
    const renderer = createGotenbergReportPdfRenderer({
      renderUrl: "https://render.example.com/",
      bearerToken: "secret-token",
      bucket: storage.stub,
      fetcher: recorder.fetcher,
    });

    const result = await renderer.render(renderRequest);

    if (result.status !== "rendered") throw new Error(JSON.stringify(result));
    expect(result.artifact).toMatchObject({
      storageKey: "reports/run-1/report.pdf",
      mimeType: "application/pdf",
    });
    const call = recorder.calls[0];
    expect(call?.url).toBe(
      "https://render.example.com/forms/chromium/convert/html",
    );
    expect(new Headers(call?.init.headers).get("Authorization")).toBe(
      "Bearer secret-token",
    );
    expect(storage.put).toHaveBeenCalledWith(
      "reports/run-1/report.pdf",
      expect.anything(),
      expect.objectContaining({
        httpMetadata: { contentType: "application/pdf" },
        // R2 verifies the digest server-side, so a truncated upload fails loudly.
        sha256: result.artifact.checksumSha256,
      }),
    );
  });

  it("rejects a response that is not a PDF", async () => {
    const renderer = createGotenbergReportPdfRenderer({
      renderUrl: "https://render.example.com",
      bearerToken: "secret-token",
      bucket: bucket().stub,
      fetcher: vi.fn().mockResolvedValue(pdfResponse("<html>")),
    });

    await expect(renderer.render(renderRequest)).resolves.toEqual({
      status: "failed",
      error: "PDF renderer returned an invalid document.",
    });
  });

  it("rejects an oversized PDF before storing it", async () => {
    const storage = bucket();
    const renderer = createGotenbergReportPdfRenderer({
      renderUrl: "https://render.example.com",
      bearerToken: "secret-token",
      bucket: storage.stub,
      fetcher: vi.fn().mockResolvedValue(
        pdfResponse("%PDF-1.7", {
          "content-length": String(MAX_REPORT_PDF_BYTES + 1),
        }),
      ),
    });

    await expect(renderer.render(renderRequest)).resolves.toEqual({
      status: "failed",
      error: "Rendered PDF is too large.",
    });
    expect(storage.put).not.toHaveBeenCalled();
  });
});

describe("Resend email provider", () => {
  const sendRequest = {
    to: { email: "client@acme.test", name: 'Bad\r\nBcc: "attacker' },
    snapshot,
    branding: DEFAULT_REPORT_BRANDING,
    pdfStorageKey: null,
    shareUrl: "https://app.example.com/api/reports/share/token",
    idempotencyKey: "report:run-1:client@acme.test",
  };

  it("sends with a stable idempotency key and a sanitized recipient name", async () => {
    const recorder = recordingFetcher(() =>
      Response.json({ id: "message-1" }, { status: 200 }),
    );
    const provider = createResendReportEmailProvider({
      apiKey: "re_key",
      from: "Reports <reports@example.com>",
      fetcher: recorder.fetcher,
    });

    await expect(provider.send(sendRequest)).resolves.toEqual({
      status: "sent",
      providerMessageId: "message-1",
    });
    const call = recorder.calls[0];
    expect(new Headers(call?.init.headers).get("Idempotency-Key")).toBe(
      "report:run-1:client@acme.test",
    );
    expect(call?.init.body).toContain(
      '"to":["\\"Bad Bcc: attacker\\" <client@acme.test>"]',
    );
  });

  it("treats a rejected request as final and a rate limit as retryable", async () => {
    const provider = (status: number) =>
      createResendReportEmailProvider({
        apiKey: "re_key",
        from: "reports@example.com",
        fetcher: vi.fn().mockResolvedValue(new Response("", { status })),
      });

    await expect(provider(422).send(sendRequest)).resolves.toMatchObject({
      status: "failed",
      retryable: false,
    });
    await expect(provider(429).send(sendRequest)).resolves.toMatchObject({
      status: "failed",
      retryable: true,
    });
  });

  // The attachment cap governs raw PDF bytes, but the provider sees them
  // base64-encoded inside a JSON body that also carries the HTML and text
  // parts. A cap set at the provider's request limit would send a request the
  // provider rejects outright.
  it("keeps a maximum-size attachment inside the provider's request limit", async () => {
    const recorder = recordingFetcher(() =>
      Response.json({ id: "message-1" }, { status: 200 }),
    );
    const pdf = new ArrayBuffer(MAX_REPORT_PDF_BYTES);
    const provider = createResendReportEmailProvider({
      apiKey: "re_key",
      from: "reports@example.com",
      bucket: {
        get: () =>
          Promise.resolve({
            size: pdf.byteLength,
            arrayBuffer: () => Promise.resolve(pdf),
          }),
      },
      fetcher: recorder.fetcher,
    });

    await expect(
      provider.send({
        ...sendRequest,
        pdfStorageKey: "reports/run-1/report.pdf",
      }),
    ).resolves.toMatchObject({ status: "sent" });
    expect(bodyBytes(recorder.calls[0]?.init)).toBeLessThan(
      MAX_EMAIL_REQUEST_BYTES,
    );
  });

  it("reports itself unconfigured without an API key", async () => {
    const provider = createResendReportEmailProvider({
      from: "reports@example.com",
    });
    expect(provider.configured).toBe(false);
    await expect(provider.send(sendRequest)).resolves.toEqual({
      status: "unconfigured",
    });
  });
});
