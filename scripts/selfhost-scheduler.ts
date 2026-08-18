/**
 * Docker self-host cron sidecar. Miniflare (behind `vite preview`) never fires
 * the wrangler.jsonc triggers, so this process drives them over loopback.
 * Run via: pnpm exec tsx scripts/selfhost-scheduler.ts
 *
 * See src/lib/selfhost-scheduler.ts for the loop and docs/SELF_HOSTING_DOCKER.md
 * for the compose wiring and the reverse-proxy rules it depends on.
 */
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  resolveSchedulerPort,
  runSelfHostScheduler,
} from "../src/lib/selfhost-scheduler";

const port = resolveSchedulerPort(process.env);

await runSelfHostScheduler(
  {
    fetch,
    sleep: (ms) => sleep(ms),
    now: () => Date.now(),
    log: (message) => console.log(`[selfhost-scheduler] ${message}`),
  },
  { port },
);
