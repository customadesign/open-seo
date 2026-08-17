import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { withPgClient } from "@/db";
import { ReportDeliveryService } from "@/server/features/reports/ReportDeliveryService";
import { executeReportRun } from "@/server/features/reports/ReportRunExecutor";
import { pgStep } from "./pgStep";

type ReportWorkflowParams = { projectId: string; runId: string };

export class ReportWorkflow extends WorkflowEntrypoint<
  Env,
  ReportWorkflowParams
> {
  async run(event: WorkflowEvent<ReportWorkflowParams>, step: WorkflowStep) {
    return withPgClient(async () => {
      const generated = await pgStep(
        step,
        "generate-report",
        { retries: { limit: 0, delay: "30 seconds", backoff: "exponential" } },
        () =>
          executeReportRun({
            ...event.payload,
            workflowInstanceId: event.instanceId,
          }),
      );
      // Delivery is a separate step so a mail-provider outage retries the send
      // without re-running data collection or replacing the published snapshot.
      const delivered = await pgStep(
        step,
        "deliver-report",
        { retries: { limit: 2, delay: "60 seconds", backoff: "exponential" } },
        () => ReportDeliveryService.deliverRun(event.payload),
      );
      return { ...generated, delivery: delivered };
    });
  }
}
