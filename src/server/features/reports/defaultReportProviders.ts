import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import type { ReportEmailProvider, ReportPdfRenderer } from "./reportProviders";
import {
  createGotenbergReportPdfRenderer,
  createResendReportEmailProvider,
} from "./reportProvidersConfigured";

type ReportProviders = {
  pdfRenderer: ReportPdfRenderer;
  emailProvider: ReportEmailProvider;
  shareBaseUrl: string | null;
  bucket: R2Bucket | undefined;
};

let cached: Promise<ReportProviders> | null = null;

// The R2 binding only exists inside the Worker runtime; resolving it lazily
// keeps this module importable from plain Node tests and scripts.
async function reportBucket(): Promise<R2Bucket | undefined> {
  try {
    const { env } = await import("cloudflare:workers");
    return env.R2;
  } catch {
    return undefined;
  }
}

async function build(): Promise<ReportProviders> {
  const [renderUrl, bearerToken, apiKey, from, replyTo, appUrl, bucket] =
    await Promise.all([
      getOptionalEnvValue("REPORT_PDF_RENDER_URL"),
      getOptionalEnvValue("REPORT_PDF_RENDER_BEARER_TOKEN"),
      getOptionalEnvValue("RESEND_API_KEY"),
      getOptionalEnvValue("REPORT_EMAIL_FROM"),
      getOptionalEnvValue("REPORT_EMAIL_REPLY_TO"),
      getOptionalEnvValue("BETTER_AUTH_URL"),
      reportBucket(),
    ]);
  return {
    pdfRenderer: createGotenbergReportPdfRenderer({
      renderUrl,
      bearerToken,
      bucket,
    }),
    emailProvider: createResendReportEmailProvider({
      apiKey,
      from,
      replyTo,
      bucket,
    }),
    shareBaseUrl: appUrl ? appUrl.replace(/\/+$/u, "") : null,
    bucket,
  };
}

export function getReportProviders(): Promise<ReportProviders> {
  cached ??= build();
  return cached;
}
