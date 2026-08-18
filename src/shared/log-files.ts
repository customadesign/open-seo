export const MAX_LOG_FILE_BYTES = 100 * 1024 * 1024;
export const LOG_FILE_RETENTION_DAYS = 30;
export const MAX_PENDING_BOT_IPS = 256;
export const MAX_LOG_PATH_LENGTH = 2048;
export const MAX_ERROR_PATHS = 100;
export const MAX_REPORT_PATHS = 50;

export const LOG_FILE_FORMATS = ["combined", "common", "w3c"] as const;
export const LOG_FILE_STATUSES = ["processing", "completed", "failed"] as const;

/**
 * Search and retrieval crawlers already scored by site-audit robots checks.
 * Training-only agents (GPTBot, ClaudeBot, Google-Extended) stay out of this
 * list for the same reason the audit excludes them.
 */
export const LOG_FILE_BOT_IDS = [
  "googlebot",
  "bingbot",
  "oai-searchbot",
  "chatgpt-user",
  "perplexitybot",
  "claude-searchbot",
] as const;

export const LOG_FILE_BOT_LABELS: Record<LogFileBotId, string> = {
  googlebot: "Googlebot",
  bingbot: "Bingbot",
  "oai-searchbot": "OAI-SearchBot",
  "chatgpt-user": "ChatGPT-User",
  perplexitybot: "PerplexityBot",
  "claude-searchbot": "Claude-SearchBot",
};

export type LogFileFormat = (typeof LOG_FILE_FORMATS)[number];
export type LogFileStatus = (typeof LOG_FILE_STATUSES)[number];
export type LogFileBotId = (typeof LOG_FILE_BOT_IDS)[number];
export type BotVerification = "verified" | "unverified";
