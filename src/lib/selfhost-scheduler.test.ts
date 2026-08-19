import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_EXPLORER_PATH,
  MINIFLARE_CONTROL_PATH_PREFIX,
  runSelfHostScheduler,
  SCHEDULED_TRIGGER_PATH,
  SCHEDULER_TICK_MS,
  SCHEDULER_TICK_TIMEOUT_MS,
  type SchedulerRuntime,
} from "./selfhost-scheduler";

type Call = { url: string; method: string };

function runtime(
  responses: Array<Response | Error>,
): SchedulerRuntime & { calls: Call[]; sleeps: number[] } {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let elapsed = 0;
  return {
    calls,
    sleeps,
    fetch: vi.fn((url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method ?? "GET" });
      const next = responses.shift() ?? new Response("ok");
      // Each call advances the clock so tick pacing is observable.
      elapsed += 1_000;
      return next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve(next);
    }),
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    now: () => elapsed,
    log: () => {},
  };
}

describe("runSelfHostScheduler", () => {
  it("triggers only the loopback Miniflare endpoint, after the app is healthy", async () => {
    const scheduler = runtime([
      new Response("unhealthy", { status: 503 }),
      new Response("ok"),
      new Response("{}"),
    ]);

    await runSelfHostScheduler(scheduler, { port: 3001, maxTicks: 1 });

    expect(scheduler.calls).toEqual([
      { url: "http://127.0.0.1:3001/api/health", method: "GET" },
      { url: "http://127.0.0.1:3001/api/health", method: "GET" },
      {
        url: "http://127.0.0.1:3001/cdn-cgi/handler/scheduled?cron=*%2F5+*+*+*+*&format=json",
        method: "POST",
      },
    ]);
  });

  it("serializes ticks on the 5-minute wall clock and never retries a failure early", async () => {
    const scheduler = runtime([
      new Response("ok"),
      new Error("connection reset"),
      new Response("boom", { status: 500 }),
    ]);

    await runSelfHostScheduler(scheduler, { port: 3001, maxTicks: 2 });

    const triggers = scheduler.calls.filter((call) => call.method === "POST");
    expect(triggers).toHaveLength(2);
    // Each failed tick waits out the rest of its own slot instead of retrying.
    expect(scheduler.sleeps).toEqual([
      SCHEDULER_TICK_MS - 1_000,
      SCHEDULER_TICK_MS - 1_000,
    ]);
    // A tick aborts before its slot ends, so it can never overlap the next one.
    expect(SCHEDULER_TICK_TIMEOUT_MS).toBeLessThan(SCHEDULER_TICK_MS);
  });

  it("keeps the self-host proxy guide denying the whole Miniflare control prefix", () => {
    expect(
      SCHEDULED_TRIGGER_PATH.startsWith(MINIFLARE_CONTROL_PATH_PREFIX),
    ).toBe(true);
    // The explorer has read/write access to D1, KV, and R2 — a deny rule
    // narrowed to the scheduled path alone would leave it exposed.
    expect(LOCAL_EXPLORER_PATH.startsWith(MINIFLARE_CONTROL_PATH_PREFIX)).toBe(
      true,
    );

    const guide = readFileSync(
      new URL("../../docs/SELF_HOSTING_DOCKER.md", import.meta.url),
      "utf8",
    );
    expect(guide).toContain(`location ${MINIFLARE_CONTROL_PATH_PREFIX}`);
    expect(guide).not.toContain(`location ${SCHEDULED_TRIGGER_PATH}`);
  });
});
