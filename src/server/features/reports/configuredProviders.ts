import { z } from "zod";
import { renderReportEmail, renderReportHtml } from "./reportPresentation";
import type { ReportEmailProvider, ReportPdfRenderer } from "./providers";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const resendResponseSchema = z.object({ id: z.string().min(1).max(500) });

type Fetcher = typeof fetch;

type ReportPdfStorage = {
  put(
    key: string,
    value: ArrayBuffer,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
    },
  ): Promise<unknown>;
};

type ReportEmailStorage = {
  get(key: string): Promise<{
    size?: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  } | null>;
};

function normalizedHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.pathname = url.pathname.replace(/\/+$/u, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function startsWithPdfMagic(value: ArrayBuffer): boolean {
  const bytes = new Uint8Array(value, 0, Math.min(value.byteLength, 5));
  return String.fromCharCode(...bytes) === "%PDF-";
}

export function createGotenbergReportPdfRenderer(input: {
  renderUrl?: string;
  bearerToken?: string;
  bucket?: ReportPdfStorage;
  fetcher?: Fetcher;
}): ReportPdfRenderer {
  const renderUrl = normalizedHttpUrl(input.renderUrl);
  const configured = Boolean(renderUrl && input.bucket);
  return {
    configured,
    async render(request) {
      if (!renderUrl || !input.bucket) return { status: "unconfigured" };
      try {
        const html = renderReportHtml(request.snapshot);
        const form = new FormData();
        form.append(
          "files",
          new File([html], "index.html", { type: "text/html;charset=utf-8" }),
        );
        form.append("printBackground", "true");
        form.append("preferCssPageSize", "true");
        const headers = new Headers();
        if (input.bearerToken) {
          headers.set("Authorization", `Bearer ${input.bearerToken}`);
        }
        const response = await (input.fetcher ?? fetch)(
          `${renderUrl}/forms/chromium/convert/html`,
          {
            method: "POST",
            headers,
            body: form,
            redirect: "error",
            signal: AbortSignal.timeout(60_000),
          },
        );
        if (!response.ok) {
          return {
            status: "failed",
            error: `PDF renderer returned HTTP ${response.status}.`,
          };
        }
        const declaredSize = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredSize) && declaredSize > MAX_PDF_BYTES) {
          return { status: "failed", error: "Rendered PDF is too large." };
        }
        const pdf = await response.arrayBuffer();
        if (pdf.byteLength > MAX_PDF_BYTES) {
          return { status: "failed", error: "Rendered PDF is too large." };
        }
        if (!startsWithPdfMagic(pdf)) {
          return {
            status: "failed",
            error: "PDF renderer returned an invalid document.",
          };
        }
        const checksumSha256 = await sha256Hex(pdf);
        const storageKey = `reports/${request.runId}/report.pdf`;
        await input.bucket.put(storageKey, pdf, {
          httpMetadata: { contentType: "application/pdf" },
          customMetadata: {
            checksumSha256,
            idempotencyKey: request.idempotencyKey,
          },
        });
        return {
          status: "rendered",
          artifact: {
            storageKey,
            mimeType: "application/pdf",
            sizeBytes: pdf.byteLength,
            checksumSha256,
          },
        };
      } catch (error) {
        console.error("Report PDF rendering failed", error);
        return { status: "failed", error: "PDF rendering failed." };
      }
    },
  };
}

function recipientAddress(email: string, name: string | null): string {
  if (!name) return email;
  const safeName = name.replaceAll(/[\r\n"<>]/gu, " ").trim();
  return safeName ? `"${safeName}" <${email}>` : email;
}

export function createResendReportEmailProvider(input: {
  apiKey?: string;
  from?: string;
  replyTo?: string;
  bucket?: ReportEmailStorage;
  fetcher?: Fetcher;
}): ReportEmailProvider {
  const configured = Boolean(input.apiKey && input.from);
  return {
    configured,
    async send(request) {
      if (!input.apiKey || !input.from) return { status: "unconfigured" };
      try {
        let attachment: { filename: string; content: string } | null = null;
        if (request.pdfStorageKey) {
          if (!input.bucket) {
            return {
              status: "failed",
              error: "Report attachment storage is unavailable.",
            };
          }
          const object = await input.bucket.get(request.pdfStorageKey);
          if (!object) {
            return {
              status: "failed",
              error: "Report PDF attachment was not found.",
            };
          }
          if (object.size !== undefined && object.size > MAX_PDF_BYTES) {
            return { status: "failed", error: "Report PDF is too large." };
          }
          const pdf = await object.arrayBuffer();
          if (pdf.byteLength > MAX_PDF_BYTES) {
            return { status: "failed", error: "Report PDF is too large." };
          }
          attachment = {
            filename: `${
              request.snapshot.project.name
                .replaceAll(/[^a-z0-9]+/giu, "-")
                .replaceAll(/^-|-$/gu, "")
                .toLowerCase() || "seo"
            }-report.pdf`,
            content: Buffer.from(pdf).toString("base64"),
          };
        }
        const message = renderReportEmail({
          snapshot: request.snapshot,
          hasPdf: attachment !== null,
        });
        const response = await (input.fetcher ?? fetch)(
          "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${input.apiKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": request.idempotencyKey,
            },
            body: JSON.stringify({
              from: input.from,
              to: [recipientAddress(request.to.email, request.to.name)],
              subject: request.subject,
              html: message.html,
              text: message.text,
              ...(input.replyTo ? { reply_to: input.replyTo } : {}),
              ...(attachment ? { attachments: [attachment] } : {}),
            }),
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok) {
          return {
            status: "failed",
            error: `Email provider returned HTTP ${response.status}.`,
          };
        }
        const parsed = resendResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          return {
            status: "failed",
            error: "Email provider returned an invalid response.",
          };
        }
        return { status: "sent", providerMessageId: parsed.data.id };
      } catch (error) {
        console.error("Report email delivery failed", error);
        return { status: "failed", error: "Report email delivery failed." };
      }
    },
  };
}
