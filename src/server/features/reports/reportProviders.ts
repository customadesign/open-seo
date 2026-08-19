import type { ReportSnapshot } from "@/types/schemas/reports";
import type {
  ReportCommentaryLine,
  ResolvedReportBranding,
} from "./reportPresentation";

type ReportPdfArtifact = {
  storageKey: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  checksumSha256: string;
};

export type ReportPdfRenderResult =
  | { status: "rendered"; artifact: ReportPdfArtifact }
  | { status: "unconfigured" }
  | { status: "failed"; error: string };

export interface ReportPdfRenderer {
  readonly configured: boolean;
  render(input: {
    runId: string;
    snapshot: ReportSnapshot;
    branding: ResolvedReportBranding;
    commentary: ReportCommentaryLine[];
    idempotencyKey: string;
  }): Promise<ReportPdfRenderResult>;
}

export type ReportEmailSendResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "unconfigured" }
  | { status: "failed"; error: string; retryable: boolean };

export interface ReportEmailProvider {
  readonly configured: boolean;
  send(input: {
    to: { email: string; name: string | null };
    snapshot: ReportSnapshot;
    branding: ResolvedReportBranding;
    pdfStorageKey: string | null;
    shareUrl: string | null;
    idempotencyKey: string;
  }): Promise<ReportEmailSendResult>;
}
