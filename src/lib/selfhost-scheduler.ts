/**
 * Cron driver for Docker self-hosting.
 *
 * Cloudflare runs the `scheduled` handler in src/server.ts from the triggers in
 * wrangler.jsonc. Docker self-hosts serve the same Worker through
 * `vite preview` -> Miniflare, which never fires those triggers on its own, so
 * every scheduled subsystem (recurring site audits, rank checks, geo-grids,
 * monthly reports, the stale-audit watchdog) stays dead unless something asks
 * Miniflare to run it.
 * The compose sidecar is that something.
 *
 * Security: the trigger endpoint is unauthenticated and runs metered provider
 * work, and its `/cdn-cgi/` siblings include Miniflare's local explorer
 * (read/write access to D1, KV, and R2). The sidecar shares the app
 * container's network namespace so it can only ever reach the endpoint over
 * loopback, and docs/SELF_HOSTING_DOCKER.md tells operators to deny the whole
 * prefix at their reverse proxy.
 */

/** Matches the 5-minute trigger in wrangler.jsonc; `scheduled` dispatches on it. */
const SELF_HOST_SCHEDULER_CRON = "*/5 * * * *";

export const SCHEDULER_TICK_MS = 5 * 60_000;

/**
 * Abort a tick before its slot ends. The loop runs one tick at a time, so a
 * request that outlived its own 5-minute window would push every later tick
 * late; cutting it here keeps ticks on the wall clock. The 30s of slack
 * absorbs the request setup either side of the timeout.
 */
export const SCHEDULER_TICK_TIMEOUT_MS = 270_000;

const SCHEDULER_HEALTH_POLL_MS = 5_000;
const SCHEDULER_HEALTH_TIMEOUT_MS = 10_000;

/**
 * Every Miniflare control path lives under this prefix — the scheduled trigger,
 * the local explorer, the email handler. A self-host reverse proxy must deny
 * the whole prefix; denying only the path the sidecar uses still leaves the
 * explorer reachable.
 */
export const MINIFLARE_CONTROL_PATH_PREFIX = "/cdn-cgi/";
export const SCHEDULED_TRIGGER_PATH = `${MINIFLARE_CONTROL_PATH_PREFIX}handler/scheduled`;
export const LOCAL_EXPLORER_PATH = `${MINIFLARE_CONTROL_PATH_PREFIX}explorer`;
const HEALTH_PATH = "/api/health";

const DEFAULT_PORT = 3001;

/**
 * Loopback only, never configurable: the sidecar shares the app's network
 * namespace precisely so this endpoint can't be addressed from anywhere else.
 */
const LOOPBACK_HOST = "127.0.0.1";

/** The slice of `fetch` this loop uses; the global satisfies it. */
export type SchedulerFetch = (
  url: string,
  init?: { method?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export type SchedulerRuntime = {
  fetch: SchedulerFetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
};

export function resolveSchedulerPort(
  env: Record<string, string | undefined>,
): number {
  const raw = env.PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Self-host scheduler: invalid PORT "${raw}"`);
  }
  return port;
}

function buildScheduledTriggerUrl(port: number): string {
  const url = new URL(
    `http://${LOOPBACK_HOST}:${port}${SCHEDULED_TRIGGER_PATH}`,
  );
  url.searchParams.set("cron", SELF_HOST_SCHEDULER_CRON);
  // JSON reports the handler outcome, so a throwing tick surfaces as a 500 in
  // the sidecar log instead of a bare "ok".
  url.searchParams.set("format", "json");
  return url.toString();
}

function buildHealthUrl(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}${HEALTH_PATH}`;
}

/**
 * Block until the app answers its health endpoint. A first container start
 * runs migrations plus a multi-minute vite build, and triggering before the
 * Worker is up would just burn ticks on connection refusals.
 */
async function waitForAppHealth(
  runtime: SchedulerRuntime,
  port: number,
): Promise<void> {
  const url = buildHealthUrl(port);
  for (;;) {
    try {
      const response = await runtime.fetch(url, {
        signal: AbortSignal.timeout(SCHEDULER_HEALTH_TIMEOUT_MS),
      });
      if (response.ok) return;
    } catch {
      // Still building, migrating, or restarting — keep waiting.
    }
    await runtime.sleep(SCHEDULER_HEALTH_POLL_MS);
  }
}

/** Run one tick. Never throws: a failed tick is logged and waits its turn. */
async function triggerScheduledTick(
  runtime: SchedulerRuntime,
  url: string,
): Promise<void> {
  try {
    const response = await runtime.fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(SCHEDULER_TICK_TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      runtime.log(`tick failed: HTTP ${response.status} ${body}`);
    }
  } catch (error) {
    runtime.log(
      `tick failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Serialized 5-minute loop. `maxTicks` exists for tests; the sidecar runs
 * unbounded.
 */
export async function runSelfHostScheduler(
  runtime: SchedulerRuntime,
  options: { port: number; maxTicks?: number },
): Promise<void> {
  const url = buildScheduledTriggerUrl(options.port);
  await waitForAppHealth(runtime, options.port);
  runtime.log(`app is healthy; running "${SELF_HOST_SCHEDULER_CRON}" ticks`);

  for (
    let tick = 0;
    options.maxTicks === undefined || tick < options.maxTicks;
    tick += 1
  ) {
    const startedAt = runtime.now();
    await triggerScheduledTick(runtime, url);
    // No retry before the next tick. Every scheduled handler is a due-work
    // sweep that re-reads whatever the failed tick missed, so an immediate
    // retry would only stack metered work on an app that is already unwell.
    await runtime.sleep(
      Math.max(0, SCHEDULER_TICK_MS - (runtime.now() - startedAt)),
    );
  }
}
