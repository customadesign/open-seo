import type {
  AiCrawlerAccess,
  LlmsTxtStatus,
} from "@/server/lib/audit/discovery";
import type { DetectedIssue } from "@/server/lib/audit/issues/page-reporters";

export function runSitewideChecks(input: {
  origin: string;
  aiCrawlerAccess: AiCrawlerAccess[];
  llmsTxt: LlmsTxtStatus;
}): DetectedIssue[] {
  const blockedSearch = input.aiCrawlerAccess.filter(
    (crawler) => !crawler.allowed && crawler.kind === "search",
  );
  const blockedAiSearch = input.aiCrawlerAccess.filter(
    (crawler) => !crawler.allowed && crawler.kind === "ai-search",
  );
  const issues: DetectedIssue[] = [];

  if (blockedSearch.length > 0) {
    issues.push({
      issueType: "search-crawler-blocked",
      pageId: null,
      pageUrl: `${input.origin}/robots.txt`,
      details: {
        blocked: blockedSearch.map(({ userAgent, label }) => ({
          userAgent,
          label,
        })),
      },
    });
  }

  if (blockedAiSearch.length > 0) {
    issues.push({
      issueType: "ai-search-crawler-blocked",
      pageId: null,
      pageUrl: `${input.origin}/robots.txt`,
      details: {
        blocked: blockedAiSearch.map(({ userAgent, label }) => ({
          userAgent,
          label,
        })),
      },
    });
  }

  if (!input.llmsTxt.available) {
    issues.push({
      issueType: "missing-llms-txt",
      pageId: null,
      pageUrl: `${input.origin}/llms.txt`,
      details: { statusCode: input.llmsTxt.statusCode },
    });
  }

  return issues;
}
