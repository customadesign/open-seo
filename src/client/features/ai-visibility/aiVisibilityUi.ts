import type { AiVisibilityProvider } from "@/shared/ai-visibility";

export const AI_VISIBILITY_PROVIDER_LABELS: Record<
  AiVisibilityProvider,
  string
> = {
  chatgpt_search: "ChatGPT Search",
  gemini: "Gemini",
  google_ai_mode: "Google AI Mode",
};
