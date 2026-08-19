import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  executeReportRun: vi.fn(),
  deliverRun: vi.fn(),
  pgStep: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: vi.fn(),
}));
vi.mock("@/db", () => ({ withPgClient: (fn: () => unknown) => fn() }));
vi.mock("@/server/features/reports/ReportRunExecutor", () => ({
  executeReportRun: mocks.executeReportRun,
}));
vi.mock("@/server/features/reports/ReportDeliveryService", () => ({
  ReportDeliveryService: { deliverRun: mocks.deliverRun },
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
    // A failed generation must not attempt delivery of a run that never
    // published.
    expect(mocks.deliverRun).not.toHaveBeenCalled();
  });

  it("delivers in a retryable step of its own", async () => {
    const stepConfigs: Array<{ name: string; retries?: { limit?: number } }> =
      [];
    mocks.pgStep.mockImplementation(
      async (
        _step: unknown,
        name: string,
        config: { retries?: { limit?: number } },
        callback: () => Promise<unknown>,
      ) => {
        stepConfigs.push({ name, retries: config.retries });
        return callback();
      },
    );
    mocks.executeReportRun.mockResolvedValue({ status: "published" });
    mocks.deliverRun.mockResolvedValue({ runId: "run-1", sent: 1 });
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
    ).resolves.toMatchObject({
      status: "published",
      delivery: { sent: 1 },
    });

    expect(stepConfigs.map((step) => step.name)).toEqual([
      "generate-report",
      "deliver-report",
    ]);
    // Mail provider outages retry the send without regenerating the snapshot.
    expect(stepConfigs[1]?.retries?.limit).toBe(2);
  });
});
