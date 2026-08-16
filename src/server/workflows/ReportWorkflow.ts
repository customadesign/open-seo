import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { withPgClient } from "@/db";
import { executeReportRun } from "@/server/features/reports/ReportRunExecutor";
import { pgStep } from "./pgStep";

type ReportWorkflowParams = { projectId: string; runId: string };

export class ReportWorkflow extends WorkflowEntrypoint<
  Env,
  ReportWorkflowParams
> {
  async run(event: WorkflowEvent<ReportWorkflowParams>, step: WorkflowStep) {
    return withPgClient(() =>
      pgStep(
        step,
        "generate-report",
        { retries: { limit: 0, delay: "30 seconds", backoff: "exponential" } },
        () =>
          executeReportRun({
            ...event.payload,
            workflowInstanceId: event.instanceId,
          }),
      ),
    );
  }
}
