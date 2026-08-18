import { z } from "zod";
import { SerpGoogleAiModeLiveAdvancedRequestInfo } from "dataforseo-client";
import { fetchLlmResponse } from "@/server/lib/dataforseo/ai";
import { serpApi } from "@/server/lib/dataforseo/core";
import {
  assertOk,
  buildTaskBilling,
  DataforseoChargedTaskError,
  isRecord,
  type DataforseoApiResponse,
} from "@/server/lib/dataforseo/envelope";
import { getIsoCountryCode } from "@/shared/keyword-locations";
import type { AiVisibilityProvider } from "@/shared/ai-visibility";

// One provider answer, normalized across the two very different payload shapes
// (LLM responses vs a Google AI Mode SERP element). Everything the observation
// shaping needs and nothing else.

export interface AiVisibilityReference {
  url: string | null;
  title: string | null;
}

export interface AiVisibilityAnswer {
  text: string;
  modelName: string | null;
  references: AiVisibilityReference[];
}

/** Model aliases validated by ai.ts before dispatch; see the note there. */
const PROVIDER_MODEL_NAMES = {
  chatgpt_search: "gpt-5",
  gemini: "gemini-2.5-pro",
} as const;

const aiModeReferenceSchema = z
  .object({
    url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
  })
  .passthrough();

const aiModeItemSchema = z
  .object({
    type: z.string().nullable().optional(),
    markdown: z.string().nullable().optional(),
    references: z.array(aiModeReferenceSchema).nullable().optional(),
  })
  .passthrough();

const aiModeResultSchema = z
  .object({
    // A successful AI Mode result always carries the item collection (it may
    // be empty when the surface has no answer). Requiring the collection keeps
    // an empty/malformed provider payload from being reported as a valid zero.
    items: z.array(aiModeItemSchema).nullable(),
  })
  .passthrough();

export function fetchAiVisibilityAnswer(input: {
  provider: AiVisibilityProvider;
  prompt: string;
  locationCode: number;
  languageCode: string;
}): Promise<DataforseoApiResponse<AiVisibilityAnswer>> {
  return input.provider === "google_ai_mode"
    ? fetchGoogleAiModeAnswer(input)
    : fetchLlmProviderAnswer(input.provider, input);
}

async function fetchLlmProviderAnswer(
  provider: "chatgpt_search" | "gemini",
  input: { prompt: string; locationCode: number },
): Promise<DataforseoApiResponse<AiVisibilityAnswer>> {
  const response = await fetchLlmResponse({
    userPrompt: input.prompt,
    modelSlug: provider === "chatgpt_search" ? "chat_gpt" : "gemini",
    modelName: PROVIDER_MODEL_NAMES[provider],
    // Without web search the model answers from training data, which says
    // nothing about present-day AI search visibility.
    webSearch: true,
    webSearchCountryCode: getIsoCountryCode(input.locationCode),
  });

  const textParts: string[] = [];
  const references: AiVisibilityReference[] = [];
  for (const item of response.data.items ?? []) {
    if (item.type !== "message") continue;
    for (const section of item.sections ?? []) {
      if (typeof section.text === "string" && section.text.length > 0) {
        textParts.push(section.text);
      }
      for (const annotation of section.annotations ?? []) {
        references.push({
          url: annotation.url ?? null,
          title: annotation.title ?? null,
        });
      }
    }
  }

  return {
    data: {
      text: textParts.join("\n\n").trim(),
      modelName: response.data.model_name ?? null,
      references,
    },
    billing: response.billing,
  };
}

async function fetchGoogleAiModeAnswer(input: {
  prompt: string;
  locationCode: number;
  languageCode: string;
}): Promise<DataforseoApiResponse<AiVisibilityAnswer>> {
  const response = await serpApi().googleAiModeLiveAdvanced([
    new SerpGoogleAiModeLiveAdvancedRequestInfo({
      keyword: input.prompt,
      location_code: input.locationCode,
      language_code: input.languageCode,
    }),
  ]);
  const task = assertOk(response);
  // The task has already succeeded (and therefore may already be billed) by
  // the time we inspect its result. Capture billing before parsing so a
  // provider payload regression cannot turn a charged call into an unmetered
  // generic error.
  const billing = buildTaskBilling(task);
  const rawResult = task.result?.[0];
  if (!isRecord(rawResult)) {
    throw new DataforseoChargedTaskError(
      "DataForSEO google/ai_mode returned an invalid result shape",
      billing,
    );
  }

  const parsed = aiModeResultSchema.safeParse(rawResult);
  if (!parsed.success) {
    throw new DataforseoChargedTaskError(
      "DataForSEO google/ai_mode returned an invalid result shape",
      billing,
    );
  }

  const textParts: string[] = [];
  const references: AiVisibilityReference[] = [];
  for (const item of parsed.data.items ?? []) {
    if (typeof item.markdown === "string" && item.markdown.length > 0) {
      textParts.push(item.markdown);
    }
    for (const reference of item.references ?? []) {
      references.push({
        url: reference.url ?? null,
        title: reference.title ?? reference.source ?? null,
      });
    }
  }

  return {
    data: {
      text: textParts.join("\n\n").trim(),
      // AI Mode is a SERP surface, not a named model.
      modelName: null,
      references,
    },
    billing,
  };
}
