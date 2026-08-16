import { env } from "cloudflare:workers";
import { getEnvValueSync } from "@/server/lib/runtime-env";
import {
  createGotenbergReportPdfRenderer,
  createResendReportEmailProvider,
} from "./configuredProviders";

export const defaultReportPdfRenderer = createGotenbergReportPdfRenderer({
  renderUrl: getEnvValueSync(env, "REPORT_PDF_RENDER_URL"),
  bearerToken: getEnvValueSync(env, "REPORT_PDF_RENDER_BEARER_TOKEN"),
  bucket: env.R2,
});

export const defaultReportEmailProvider = createResendReportEmailProvider({
  apiKey: getEnvValueSync(env, "RESEND_API_KEY"),
  from: getEnvValueSync(env, "REPORT_EMAIL_FROM"),
  replyTo: getEnvValueSync(env, "REPORT_EMAIL_REPLY_TO"),
  bucket: env.R2,
});
