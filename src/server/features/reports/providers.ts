import type { ReportSnapshot } from "@/types/schemas/reports";

export type ReportPdfRenderResult =
  | {
      status: "rendered";
      artifact: {
        storageKey: string;
        mimeType: "application/pdf";
        sizeBytes: number | null;
        checksumSha256: string | null;
      };
    }
  | { status: "unconfigured" }
  | { status: "failed"; error: string };

export interface ReportPdfRenderer {
  readonly configured: boolean;
  render(input: {
    runId: string;
    snapshot: ReportSnapshot;
    idempotencyKey: string;
  }): Promise<ReportPdfRenderResult>;
}

export type ReportEmailSendResult =
  | { status: "sent"; providerMessageId: string }
  | { status: "unconfigured" }
  | { status: "failed"; error: string };

export interface ReportEmailProvider {
  readonly configured: boolean;
  send(input: {
    to: { email: string; name: string | null };
    subject: string;
    snapshot: ReportSnapshot;
    pdfStorageKey: string | null;
    idempotencyKey: string;
  }): Promise<ReportEmailSendResult>;
}

export const unconfiguredReportPdfRenderer: ReportPdfRenderer = {
  configured: false,
  async render() {
    return { status: "unconfigured" };
  },
};
