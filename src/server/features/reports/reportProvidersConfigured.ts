import { z } from "zod";
import { MAX_REPORT_PDF_BYTES } from "@/shared/report-delivery";
import { renderReportEmail, renderReportHtml } from "./reportPresentation";
import type { ReportEmailProvider, ReportPdfRenderer } from "./reportProviders";

const resendResponseSchema = z.object({ id: z.string().min(1).max(500) });

const RENDER_TIMEOUT_MS = 60_000;
const EMAIL_TIMEOUT_MS = 30_000;

// Narrow on purpose: this module only ever issues one-shot POSTs, and the
// smaller signature lets tests pass a plain function instead of a cast.
export type ReportFetcher = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

type ReportPdfStorage = {
  put(
    key: string,
    value: ArrayBuffer,
    options: {
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
      // R2 verifies this digest server-side and rejects a corrupted upload.
      sha256: string;
    },
  ): Promise<unknown>;
};

type ReportEmailStorage = {
  get(
    key: string,
  ): Promise<{ size?: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
};

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Gotenberg ships without authentication and its maintainers advise against
 * exposing it publicly, so the only accepted endpoint is a public HTTPS origin
 * fronted by something that checks the bearer token — which means a public URL
 * without a token is rejected rather than used unauthenticated. Plain http and
 * a missing token are allowed for loopback only, where a developer runs the
 * container on their own machine.
 */
function usableRendererUrl(
  value: string | undefined,
  bearerToken: string | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const isLoopback = LOOPBACK_HOSTS.includes(url.hostname);
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && isLoopback)
    ) {
      return null;
    }
    if (!isLoopback && !bearerToken?.trim()) {
      console.warn(
        "REPORT_PDF_RENDER_URL is ignored: a non-loopback renderer requires REPORT_PDF_RENDER_BEARER_TOKEN.",
      );
      return null;
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/u, "");
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
  fetcher?: ReportFetcher;
}): ReportPdfRenderer {
  const renderUrl = usableRendererUrl(input.renderUrl, input.bearerToken);
  return {
    configured: Boolean(renderUrl && input.bucket),
    async render(request) {
      const bucket = input.bucket;
      if (!renderUrl || !bucket) return { status: "unconfigured" };
      try {
        // allowRemoteAssets stays off: the renderer resolves every URL in the
        // document, so a stored logo URL would become a server-side fetch.
        const html = renderReportHtml({
          snapshot: request.snapshot,
          branding: request.branding,
          commentary: request.commentary,
          allowRemoteAssets: false,
        });
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
            signal: AbortSignal.timeout(RENDER_TIMEOUT_MS),
          },
        );
        if (!response.ok) {
          return {
            status: "failed",
            error: `PDF renderer returned HTTP ${response.status}.`,
          };
        }
        const declaredSize = Number(response.headers.get("content-length"));
        if (
          Number.isFinite(declaredSize) &&
          declaredSize > MAX_REPORT_PDF_BYTES
        ) {
          return { status: "failed", error: "Rendered PDF is too large." };
        }
        const pdf = await response.arrayBuffer();
        if (pdf.byteLength > MAX_REPORT_PDF_BYTES) {
          return { status: "failed", error: "Rendered PDF is too large." };
        }
        if (!startsWithPdfMagic(pdf)) {
          return {
            status: "failed",
            error: "PDF renderer returned an invalid document.",
          };
        }
        const checksumSha256 = await sha256Hex(pdf);
        // Stable per run: a retry replaces the object instead of orphaning one.
        const storageKey = `reports/${request.runId}/report.pdf`;
        await bucket.put(storageKey, pdf, {
          httpMetadata: { contentType: "application/pdf" },
          customMetadata: {
            checksumSha256,
            idempotencyKey: request.idempotencyKey,
          },
          sha256: checksumSha256,
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

// Recipient names reach an RFC 5322 address. Stripping CR, LF, quotes and
// angle brackets keeps a hostile display name from forging headers.
function sanitizeEmailHeaderValue(value: string): string {
  return value
    .replace(/[\r\n"<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recipientAddress(email: string, name: string | null): string {
  const safeName = name ? sanitizeEmailHeaderValue(name) : "";
  return safeName ? `"${safeName}" <${email}>` : email;
}

function attachmentFilename(projectName: string): string {
  const slug = projectName
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
  return `${slug || "seo"}-report.pdf`;
}

export function createResendReportEmailProvider(input: {
  apiKey?: string;
  from?: string;
  replyTo?: string;
  bucket?: ReportEmailStorage;
  fetcher?: ReportFetcher;
}): ReportEmailProvider {
  return {
    configured: Boolean(input.apiKey && input.from),
    async send(request) {
      if (!input.apiKey || !input.from) return { status: "unconfigured" };
      try {
        let attachment: { filename: string; content: string } | null = null;
        if (request.pdfStorageKey) {
          if (!input.bucket) {
            return {
              status: "failed",
              error: "Report attachment storage is unavailable.",
              retryable: false,
            };
          }
          const object = await input.bucket.get(request.pdfStorageKey);
          if (!object) {
            return {
              status: "failed",
              error: "Report PDF attachment was not found.",
              retryable: false,
            };
          }
          if (object.size !== undefined && object.size > MAX_REPORT_PDF_BYTES) {
            return {
              status: "failed",
              error: "Report PDF is too large to attach.",
              retryable: false,
            };
          }
          const pdf = await object.arrayBuffer();
          if (pdf.byteLength > MAX_REPORT_PDF_BYTES) {
            return {
              status: "failed",
              error: "Report PDF is too large to attach.",
              retryable: false,
            };
          }
          attachment = {
            filename: attachmentFilename(request.snapshot.project.name),
            content: Buffer.from(pdf).toString("base64"),
          };
        }
        const message = renderReportEmail({
          snapshot: request.snapshot,
          branding: request.branding,
          hasPdf: attachment !== null,
          shareUrl: request.shareUrl,
        });
        const response = await (input.fetcher ?? fetch)(
          "https://api.resend.com/emails",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${input.apiKey}`,
              "Content-Type": "application/json",
              // Resend keeps idempotency keys for 24 hours, so a retried
              // attempt reuses the original send instead of mailing twice.
              "Idempotency-Key": request.idempotencyKey,
            },
            body: JSON.stringify({
              from: sanitizeEmailHeaderValue(input.from),
              to: [recipientAddress(request.to.email, request.to.name)],
              subject: sanitizeEmailHeaderValue(message.subject),
              html: message.html,
              text: message.text,
              ...(input.replyTo
                ? { reply_to: sanitizeEmailHeaderValue(input.replyTo) }
                : {}),
              ...(attachment ? { attachments: [attachment] } : {}),
            }),
            redirect: "error",
            signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
          },
        );
        if (!response.ok) {
          // 4xx other than rate limiting means the request itself is wrong;
          // retrying it just burns attempts.
          const retryable = response.status === 429 || response.status >= 500;
          return {
            status: "failed",
            error: `Email provider returned HTTP ${response.status}.`,
            retryable,
          };
        }
        const parsed = resendResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          return {
            status: "failed",
            error: "Email provider returned an invalid response.",
            retryable: false,
          };
        }
        return { status: "sent", providerMessageId: parsed.data.id };
      } catch (error) {
        console.error("Report email delivery failed", error);
        return {
          status: "failed",
          error: "Report email delivery failed.",
          retryable: true,
        };
      }
    },
  };
}
