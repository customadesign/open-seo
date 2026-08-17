import process from "node:process";
import {
  fetchAiVisibilityTaskResult,
  postAiVisibilityTasks,
} from "@/server/lib/dataforseo/ai-visibility";
import { postRankCheckTasks } from "@/server/lib/dataforseo/serp";
import {
  AI_VISIBILITY_PROVIDERS,
  isAiVisibilityProvider,
  providerCostUsd,
  type AiVisibilityProvider,
} from "@/shared/ai-visibility";
import { applyBillingMarkupUsd } from "@/shared/billing";
import { loadLocalEnv, parseArgs } from "./cli-utils";

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));

await main();

/**
 * Confirm what the new SEMrush-replacement collection paths actually cost at
 * DataForSEO, so the estimate constants can be checked against invoices rather
 * than trusted.
 *
 * - `--mode=ai` posts ONE prompt per selected provider and reports the settled
 *   cost against the estimate constant in shared/ai-visibility.ts.
 * - `--mode=bing` posts one queued Bing rank-check task at the given depth. It
 *   is the full-depth cost that matters: Bing cannot early-stop the crawl, so
 *   unlike Google its settled cost never falls below the posted cost.
 * - `--mode=all` (default) does both.
 *
 * Collection (`task_get`) is free, so polling for the settled amount adds no
 * spend. Posted tasks are charged even if we never collect them.
 */
async function main() {
  if (process.env.CI === "true" && args.allowCi !== "true") {
    printUsageAndExit(
      "Refusing to run live billing checks in CI without --allowCi=true.",
    );
  }
  if (args.confirmLive !== "true") {
    printUsageAndExit(
      "This command makes live, billable DataForSEO requests. Re-run with --confirmLive=true.",
    );
  }
  if (!process.env.DATAFORSEO_API_KEY) {
    printUsageAndExit("Missing DATAFORSEO_API_KEY.");
  }

  const mode = parseMode(args.mode);
  const locationCode = parsePositiveInteger(args.locationCode, 2840);
  const languageCode = args.languageCode ?? "en";
  const records: CallRecord[] = [];

  if (mode === "ai" || mode === "all") {
    const prompt = args.prompt ?? "What are the best SEO platforms?";
    for (const provider of parseProviders(args.providers)) {
      records.push(
        await profileProvider({ provider, prompt, locationCode, languageCode }),
      );
    }
  }

  if (mode === "bing" || mode === "all") {
    records.push(
      await profileBing({
        keyword: args.keyword ?? "seo software",
        domain: args.domain ?? "example.com",
        depth: parsePositiveInteger(args.depth, 20),
        locationCode,
        languageCode,
      }),
    );
  }

  const totalRawUsd = sum(records.map((record) => record.postedRawUsd));
  console.log(
    JSON.stringify(
      {
        input: { mode, locationCode, languageCode },
        calls: records,
        aggregate: {
          totalPostedRawUsd: round(totalRawUsd),
          totalPostedBilledUsd: applyBillingMarkupUsd(totalRawUsd),
        },
      },
      null,
      2,
    ),
  );
}

type CallRecord = {
  label: string;
  path: string;
  /** What DataForSEO charged at task_post. */
  postedRawUsd: number;
  postedBilledUsd: number;
  /** What our estimate constant assumed, for the same unit of work. */
  estimatedRawUsd: number | null;
  /** Settled cost reported by task_get, when collected. */
  settledRawUsd: number | null;
};

async function profileProvider(input: {
  provider: AiVisibilityProvider;
  prompt: string;
  locationCode: number;
  languageCode: string;
}): Promise<CallRecord> {
  const posted = await postAiVisibilityTasks({
    provider: input.provider,
    tasks: [
      { promptId: `cost-profile-${input.provider}`, prompt: input.prompt },
    ],
    locationCode: input.locationCode,
    languageCode: input.languageCode,
  });

  let settledRawUsd: number | null = null;
  const task = posted.data[0];
  if (task && args.collect === "true") {
    const outcome = await fetchAiVisibilityTaskResult({
      provider: input.provider,
      taskId: task.taskId,
    });
    settledRawUsd = outcome.settledCostUsd ?? null;
  }

  return {
    label: `ai:${input.provider}`,
    path: posted.billing.path.join("/"),
    postedRawUsd: round(posted.billing.costUsd),
    postedBilledUsd: applyBillingMarkupUsd(posted.billing.costUsd),
    estimatedRawUsd: providerCostUsd(input.provider),
    settledRawUsd,
  };
}

async function profileBing(input: {
  keyword: string;
  domain: string;
  depth: number;
  locationCode: number;
  languageCode: string;
}): Promise<CallRecord> {
  const posted = await postRankCheckTasks({
    engine: "bing",
    tasks: [
      {
        keyword: input.keyword,
        keywordId: "cost-profile-bing",
        device: "desktop",
      },
    ],
    locationCode: input.locationCode,
    languageCode: input.languageCode,
    depth: input.depth,
    targetDomain: input.domain,
  });

  return {
    label: `bing:rank-check@depth${input.depth}`,
    path: posted.billing.path.join("/"),
    postedRawUsd: round(posted.billing.costUsd),
    postedBilledUsd: applyBillingMarkupUsd(posted.billing.costUsd),
    estimatedRawUsd: null,
    settledRawUsd: null,
  };
}

function parseMode(value: string | undefined): "ai" | "bing" | "all" {
  if (!value || value === "all") return "all";
  if (value === "ai" || value === "bing") return value;
  printUsageAndExit(`Invalid --mode: ${value}. Expected ai, bing, or all.`);
}

function parseProviders(value: string | undefined): AiVisibilityProvider[] {
  if (!value) return [...AI_VISIBILITY_PROVIDERS];
  const providers = value.split(",").map((entry) => entry.trim());
  const invalid = providers.filter((entry) => !isAiVisibilityProvider(entry));
  if (invalid.length > 0) {
    printUsageAndExit(`Invalid --providers: ${invalid.join(", ")}`);
  }
  return providers.filter(isAiVisibilityProvider);
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function printUsageAndExit(message: string): never {
  console.error(message);
  console.error(
    "Usage: pnpm billing:ai-visibility --confirmLive=true [--mode=ai|bing|all] [--providers=chatgpt_search,gemini,google_ai_mode] [--prompt='...'] [--keyword='...'] [--domain=example.com] [--depth=20] [--locationCode=2840] [--languageCode=en] [--collect=true] [--allowCi=true]",
  );
  process.exit(1);
}
