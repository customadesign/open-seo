import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardMetric } from "@/server/features/dashboard/services/dashboardMetricTypes";
import {
  metricForViewer,
  needsMetricRefresh,
  pollQueuedAiBaseline,
} from "./metricRefresh";

function metric(overrides: Partial<DashboardMetric>): DashboardMetric {
  return {
    key: "backlinks",
    label: "Backlinks",
    value: 100,
    unit: "count",
    delta: null,
    deltaKind: "absolute",
    capturedAt: new Date().toISOString(),
    sourceLabel: "DataForSEO backlinks",
    estimated: false,
    status: "ready",
    target: "backlinks",
    note: null,
    ...overrides,
  };
}

describe("needsMetricRefresh", () => {
  it("refreshes a card that is still collecting", () => {
    expect(
      needsMetricRefresh([
        metric({ key: "mentions", status: "collecting", value: null }),
      ]),
    ).toBe(true);
  });

  it("refreshes a snapshot older than a day", () => {
    expect(
      needsMetricRefresh([
        metric({
          key: "organic_traffic",
          capturedAt: "2020-01-01T00:00:00.000Z",
        }),
      ]),
    ).toBe(true);
  });

  it("leaves today's snapshot alone", () => {
    expect(needsMetricRefresh([metric({ key: "organic_traffic" })])).toBe(
      false,
    );
  });

  it("does not retry against a plan or credit block", () => {
    expect(
      needsMetricRefresh([
        metric({
          key: "ai_visibility",
          status: "unavailable",
          value: null,
          capturedAt: null,
        }),
      ]),
    ).toBe(false);
  });

  it("retries a failed AI attempt only after its daily window", () => {
    expect(
      needsMetricRefresh([
        metric({
          key: "ai_visibility",
          status: "unavailable",
          value: null,
          capturedAt: new Date().toISOString(),
        }),
      ]),
    ).toBe(false);
    expect(
      needsMetricRefresh([
        metric({
          key: "ai_visibility",
          status: "unavailable",
          value: null,
          capturedAt: "2020-01-01T00:00:00.000Z",
        }),
      ]),
    ).toBe(true);
  });

  it("ignores cards the refresh path cannot fill in", () => {
    // Site health only moves when the user runs an audit, and the Backlink pulse
    // card owns the backlink snapshot — a stale value on either must not trigger
    // a metrics refresh on every page view.
    expect(
      needsMetricRefresh([
        metric({ key: "site_health", capturedAt: "2020-01-01T00:00:00.000Z" }),
        metric({ key: "backlinks", capturedAt: "2020-01-01T00:00:00.000Z" }),
      ]),
    ).toBe(false);
  });
});

describe("metricForViewer", () => {
  it("does not tell a client that it is collecting data they cannot trigger", () => {
    const collecting = metric({
      key: "ai_visibility",
      label: "AI Visibility",
      status: "collecting",
      value: null,
      note: "Taking your first AI visibility baseline…",
    });

    expect(metricForViewer(collecting, false).note).toBe(
      "Waiting for a workspace manager to start collection.",
    );
  });

  it("preserves collection copy for a project-tools viewer", () => {
    const collecting = metric({
      status: "collecting",
      value: null,
      note: "Taking your first AI visibility baseline…",
    });

    expect(metricForViewer(collecting, true)).toBe(collecting);
  });

  it("uses manager copy for a snapshot refresh the client cannot trigger", () => {
    const collecting = metric({
      key: "organic_traffic",
      status: "collecting",
      value: null,
      note: "Taking your first domain snapshot…",
    });

    expect(metricForViewer(collecting, false).note).toBe(
      "Waiting for a workspace manager to start collection.",
    );
  });

  it("preserves truthful copy for async non-manager collection", () => {
    const collecting = metric({
      key: "visibility",
      status: "collecting",
      value: null,
      note: "Waiting on search volume for your tracked keywords.",
    });

    expect(metricForViewer(collecting, false)).toBe(collecting);
  });
});

describe("pollQueuedAiBaseline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refetches until AI data is ready and then stops", async () => {
    vi.useFakeTimers();
    const refetch = vi
      .fn<() => Promise<DashboardMetric[]>>()
      .mockResolvedValueOnce([
        metric({
          key: "ai_visibility",
          status: "collecting",
          value: null,
        }),
      ])
      .mockResolvedValueOnce([
        metric({ key: "ai_visibility", status: "ready", value: 50 }),
      ]);

    const cleanup = pollQueuedAiBaseline({
      refetch,
      intervalMs: 10,
      maxAttempts: 5,
    });
    await Promise.resolve();
    expect(refetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(refetch).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("is bounded and cleanup-safe", async () => {
    vi.useFakeTimers();
    const refetch = vi
      .fn<() => Promise<DashboardMetric[]>>()
      .mockResolvedValue([
        metric({
          key: "ai_visibility",
          status: "collecting",
          value: null,
        }),
      ]);

    const cleanup = pollQueuedAiBaseline({
      refetch,
      intervalMs: 10,
      maxAttempts: 3,
    });
    await Promise.resolve();
    expect(refetch).toHaveBeenCalledTimes(1);
    cleanup();
    await vi.advanceTimersByTimeAsync(100);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
