import { z } from "zod";
import {
  AiOptimizationChatGptLlmScraperTaskPostRequestInfo,
  AiOptimizationGeminiLlmResponsesTaskPostRequestInfo,
  SerpGoogleAiModeTaskPostRequestInfo,
} from "dataforseo-client";
import { aiOptimizationApi, serpApi } from "@/server/lib/dataforseo/core";
import { createDataforseoBillingClassifier } from "@/server/lib/dataforseoBillingClassification";
import {
  isRecord,
  type DataforseoApiResponse,
  type DataforseoTaskLike,
} from "@/server/lib/dataforseo/envelope";
import { AppError } from "@/server/lib/errors";
import type { AiVisibilityProvider } from "@/shared/ai-visibility";
import { MAX_AI_VISIBILITY_TASKS_PER_POST } from "@/shared/ai-visibility";

// ---------------------------------------------------------------------------
// Queued AI visibility collection.
//
// All three providers follow the same shape as the rank-check queue:
// task_post is charged, task_get is free, and each posted task carries a `tag`
// so results map back to our prompt without relying on response order.
//
// Gemini's `web_search` and ChatGPT's `force_web_search` are what make these
// *visibility* observations rather than model-memory trivia: without them the
// provider answers from training data and the result says nothing about how
// the brand surfaces in AI search today.
// ---------------------------------------------------------------------------

const classifyAiVisibilityError = createDataforseoBillingClassifier({
  pathPrefix: "/ai_optimization/",
  billingIssueCode: "AI_SEARCH_BILLING_ISSUE",
  billingIssueMessage:
    "The connected DataForSEO account has a billing or balance issue",
});

/** DataForSEO Gemini model alias; see ai.ts for why this is validated. */
const GEMINI_MODEL_NAME = "gemini-2.5-pro";

/** Ceiling on a single answer, matching the Prompt Explorer budget. */
const MAX_OUTPUT_TOKENS = 4096;

interface AiVisibilityTaskInput {
  /** Our ai_visibility_prompts.id — echoed through DataForSEO's `tag`. */
  promptId: string;
  prompt: string;
}

interface PostedAiVisibilityTask extends AiVisibilityTaskInput {
  taskId: string;
}

export interface AiVisibilityCitation {
  url: string;
  domain: string | null;
  /** 1-based order the source appeared in. */
  position: number;
}

/** Normalized provider answer — everything downstream shaping needs. */
export interface AiVisibilityAnswer {
  text: string;
  modelName: string | null;
  citations: AiVisibilityCitation[];
  /** Raw provider result, persisted to R2 as evidence. */
  raw: unknown;
}

type AiVisibilityTaskOutcome =
  | { status: "pending" }
  | { status: "failed"; message: string }
  | { status: "completed"; answer: AiVisibilityAnswer };

// Task lifecycle codes meaning "not done yet", same set as the SERP queue.
const TASK_IN_PROGRESS_STATUS_CODES = new Set([20100, 40601, 40602]);

// ---------------------------------------------------------------------------
// task_post
// ---------------------------------------------------------------------------

interface PostTasksInput {
  provider: AiVisibilityProvider;
  tasks: AiVisibilityTaskInput[];
  locationCode: number;
  languageCode: string;
}

export async function postAiVisibilityTasks(
  input: PostTasksInput,
): Promise<DataforseoApiResponse<PostedAiVisibilityTask[]>> {
  if (
    input.tasks.length === 0 ||
    input.tasks.length > MAX_AI_VISIBILITY_TASKS_PER_POST
  ) {
    throw new AppError(
      "INTERNAL_ERROR",
      `task_post accepts 1-${MAX_AI_VISIBILITY_TASKS_PER_POST} tasks, got ${input.tasks.length}`,
    );
  }

  const response = await dispatchTaskPost(input);

  if (!response || response.status_code !== 20000) {
    throw new AppError(
      "INTERNAL_ERROR",
      response?.status_message || "DataForSEO task_post failed",
    );
  }

  // Cost is summed over EVERY entry — accepted or not — so anything DataForSEO
  // charged is metered. Rejected entries simply produce no posted task; the
  // workflow records them as failed observations rather than retrying at a
  // more expensive live endpoint.
  const byTag = new Map(input.tasks.map((task) => [task.promptId, task]));
  const posted: PostedAiVisibilityTask[] = [];
  let costUsd = 0;
  for (const entry of response.tasks ?? []) {
    costUsd += entry.cost ?? 0;
    const tag: unknown = entry.data?.tag;
    const task = typeof tag === "string" ? byTag.get(tag) : undefined;
    if (entry.status_code !== 20100 || !entry.id || !task) {
      console.warn(
        `dataforseo.ai_visibility.task_post.rejected-entry (${entry.status_code}): ${entry.status_message}`,
      );
      continue;
    }
    posted.push({ ...task, taskId: entry.id });
  }

  return {
    data: posted,
    billing: { path: taskPostBillingPath(input.provider), costUsd },
  };
}

function taskPostBillingPath(provider: AiVisibilityProvider): string[] {
  switch (provider) {
    case "chatgpt_search":
      return ["v3", "ai_optimization", "chat_gpt", "llm_scraper", "task_post"];
    case "gemini":
      return ["v3", "ai_optimization", "gemini", "llm_responses", "task_post"];
    case "google_ai_mode":
      return ["v3", "serp", "google", "ai_mode", "task_post"];
  }
}

type TaskPostResponse = {
  status_code?: number;
  status_message?: string;
  tasks?: Array<{
    id?: string;
    status_code?: number;
    status_message?: string;
    cost?: number;
    data?: Record<string, unknown>;
  }>;
} | null;

async function dispatchTaskPost(
  input: PostTasksInput,
): Promise<TaskPostResponse> {
  switch (input.provider) {
    case "chatgpt_search":
      return aiOptimizationApi(
        classifyAiVisibilityError,
      ).chatGptLlmScraperTaskPost(
        input.tasks.map(
          (task) =>
            new AiOptimizationChatGptLlmScraperTaskPostRequestInfo({
              keyword: task.prompt,
              location_code: input.locationCode,
              language_code: input.languageCode,
              // The whole point of this provider: answer from a live web
              // search, not from model memory.
              force_web_search: true,
              expand_citations: true,
              tag: task.promptId,
            }),
        ),
      );
    case "gemini":
      return aiOptimizationApi(
        classifyAiVisibilityError,
      ).geminiLlmResponsesTaskPost(
        input.tasks.map(
          (task) =>
            new AiOptimizationGeminiLlmResponsesTaskPostRequestInfo({
              user_prompt: task.prompt,
              model_name: GEMINI_MODEL_NAME,
              max_output_tokens: MAX_OUTPUT_TOKENS,
              web_search: true,
              tag: task.promptId,
            }),
        ),
      );
    case "google_ai_mode":
      return serpApi().googleAiModeTaskPost(
        input.tasks.map(
          (task) =>
            new SerpGoogleAiModeTaskPostRequestInfo({
              keyword: task.prompt,
              location_code: input.locationCode,
              language_code: input.languageCode,
              device: "desktop",
              os: "windows",
              tag: task.promptId,
            }),
        ),
      );
  }
}

// ---------------------------------------------------------------------------
// task_get
// ---------------------------------------------------------------------------

/**
 * Collect one queued task. Not metered and not wrapped in the billing
 * envelope: collection is free because task_post already charged. The settled
 * cost DataForSEO reports here is returned for bookkeeping only — running it
 * back through the metering seam would charge the customer twice.
 */
export async function fetchAiVisibilityTaskResult(input: {
  provider: AiVisibilityProvider;
  taskId: string;
}): Promise<AiVisibilityTaskOutcome & { settledCostUsd?: number }> {
  const response = await dispatchTaskGet(input.provider, input.taskId);
  const task = response?.tasks?.[0];
  if (!response || response.status_code !== 20000 || !task) {
    throw new AppError(
      "INTERNAL_ERROR",
      response?.status_message || "DataForSEO task_get failed",
    );
  }

  if (
    task.status_code !== undefined &&
    TASK_IN_PROGRESS_STATUS_CODES.has(task.status_code)
  ) {
    return { status: "pending" };
  }

  if (task.status_code !== 20000) {
    return {
      status: "failed",
      message:
        task.status_message || `DataForSEO task failed (${task.status_code})`,
      settledCostUsd: task.cost,
    };
  }

  const result = task.result?.[0];
  if (!isRecord(result)) {
    return {
      status: "failed",
      message: "DataForSEO task returned no result",
      settledCostUsd: task.cost,
    };
  }

  return {
    status: "completed",
    answer: parseAnswer(input.provider, result),
    settledCostUsd: task.cost,
  };
}

async function dispatchTaskGet(
  provider: AiVisibilityProvider,
  taskId: string,
): Promise<{
  status_code?: number;
  status_message?: string;
  tasks?: DataforseoTaskLike[];
} | null> {
  switch (provider) {
    case "chatgpt_search":
      return aiOptimizationApi(
        classifyAiVisibilityError,
      ).chatGptLlmScraperTaskGetAdvanced(taskId);
    case "gemini":
      return aiOptimizationApi(
        classifyAiVisibilityError,
      ).geminiLlmResponsesTaskGet(taskId);
    case "google_ai_mode":
      return serpApi().googleAiModeTaskGetAdvanced(taskId);
  }
}

// ---------------------------------------------------------------------------
// Provider payload parsing
//
// Each provider returns a different envelope; all three collapse to text +
// cited sources. Schemas are permissive (passthrough, everything optional)
// because a provider adding a field must never fail a paid collection — the
// raw payload is kept in R2 either way.
// ---------------------------------------------------------------------------

const citationSourceSchema = z
  .object({
    url: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
  })
  .passthrough();

/** ChatGPT LLM scraper: markdown answer plus the sources it actually cited. */
const chatGptScraperResultSchema = z
  .object({
    model: z.string().nullable().optional(),
    markdown: z.string().nullable().optional(),
    sources: z.array(citationSourceSchema).nullable().optional(),
  })
  .passthrough();

/** Gemini llm_responses: sectioned text with per-section URL annotations. */
const geminiResultSchema = z
  .object({
    model_name: z.string().nullable().optional(),
    items: z
      .array(
        z
          .object({
            sections: z
              .array(
                z
                  .object({
                    text: z.string().nullable().optional(),
                    annotations: z
                      .array(citationSourceSchema)
                      .nullable()
                      .optional(),
                  })
                  .passthrough(),
              )
              .nullable()
              .optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
  })
  .passthrough();

/** Google AI Mode SERP: ai_overview items carrying markdown + references. */
const aiModeResultSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            type: z.string().nullable().optional(),
            markdown: z.string().nullable().optional(),
            references: z.array(citationSourceSchema).nullable().optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
  })
  .passthrough();

function parseAnswer(
  provider: AiVisibilityProvider,
  result: Record<string, unknown>,
): AiVisibilityAnswer {
  switch (provider) {
    case "chatgpt_search": {
      const parsed = chatGptScraperResultSchema.parse(result);
      return {
        text: parsed.markdown ?? "",
        modelName: parsed.model ?? null,
        citations: toCitations(parsed.sources),
        raw: result,
      };
    }
    case "gemini": {
      const parsed = geminiResultSchema.parse(result);
      const sections = (parsed.items ?? []).flatMap(
        (item) => item.sections ?? [],
      );
      return {
        text: sections
          .map((section) => section.text ?? "")
          .filter(Boolean)
          .join("\n\n"),
        modelName: parsed.model_name ?? null,
        citations: toCitations(
          sections.flatMap((section) => section.annotations ?? []),
        ),
        raw: result,
      };
    }
    case "google_ai_mode": {
      const parsed = aiModeResultSchema.parse(result);
      const overviews = (parsed.items ?? []).filter(
        (item) => item.type === "ai_overview",
      );
      return {
        text: overviews
          .map((item) => item.markdown ?? "")
          .filter(Boolean)
          .join("\n\n"),
        // AI Mode is a SERP endpoint; Google exposes no model identifier.
        modelName: null,
        citations: toCitations(
          overviews.flatMap((item) => item.references ?? []),
        ),
        raw: result,
      };
    }
  }
}

/** Dedupe by URL, keeping first-seen order as the citation position. */
function toCitations(
  sources: Array<z.infer<typeof citationSourceSchema>> | null | undefined,
): AiVisibilityCitation[] {
  const seen = new Set<string>();
  const citations: AiVisibilityCitation[] = [];
  for (const source of sources ?? []) {
    const url = source.url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      url,
      domain: source.domain?.trim().toLowerCase() || hostnameOf(url),
      position: citations.length + 1,
    });
  }
  return citations;
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
