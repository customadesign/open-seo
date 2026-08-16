import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  executeReportRun: vi.fn(),
  pgStep: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: vi.fn(),
}));
vi.mock("@/db", () => ({ withPgClient: (fn: () => unknown) => fn() }));
vi.mock("@/server/features/reports/ReportRunExecutor", () => ({
  executeReportRun: mocks.executeReportRun,
}));
vi.mock("./pgStep", () => ({ pgStep: mocks.pgStep }));

import { ReportWorkflow } from "./ReportWorkflow";

describe("ReportWorkflow", () => {
  it("does not replay the provider-containing report step", async () => {
    let retryLimit: number | undefined;
    mocks.pgStep.mockImplementation(
      async (
        _step: unknown,
        _name: string,
        config: { retries?: { limit?: number } },
        callback: () => Promise<unknown>,
      ) => {
        retryLimit = config.retries?.limit;
        return callback();
      },
    );
    mocks.executeReportRun.mockRejectedValue(new Error("publish failed"));
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- mocked Worker base does not inspect constructor context
    const workflow = new ReportWorkflow({} as ExecutionContext, {} as Env);

    await expect(
      workflow.run(
        {
          instanceId: "workflow-1",
          timestamp: new Date(),
          payload: { projectId: "project-1", runId: "run-1" },
        },
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- pgStep mock does not inspect the opaque WorkflowStep
        {} as never,
      ),
    ).rejects.toThrow("publish failed");

    expect(retryLimit).toBe(0);
    expect(mocks.executeReportRun).toHaveBeenCalledOnce();
  });
});
