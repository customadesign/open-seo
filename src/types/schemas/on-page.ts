import { z } from "zod";
import {
  ON_PAGE_BUCKETS,
  ON_PAGE_IDEA_TYPES,
  ON_PAGE_TARGET_SOURCES,
} from "@/shared/on-page";

const projectIdField = z.string().min(1).max(160);
const urlField = z.string().trim().url().max(2048);
const keywordField = z.string().trim().min(1).max(200);

export const onPageOverviewSchema = z.object({
  projectId: projectIdField,
});

export const onPagePageSchema = z.object({
  projectId: projectIdField,
  pageId: z.string().min(1).max(160),
});

export const addOnPageTargetSchema = z.object({
  projectId: projectIdField,
  url: urlField,
  keyword: keywordField,
  locationCode: z.number().int().optional(),
  languageCode: z.string().min(2).max(10).optional(),
});

export const removeOnPageTargetSchema = z.object({
  projectId: projectIdField,
  pageId: z.string().min(1).max(160),
});

export const removeOnPageKeywordSchema = z.object({
  projectId: projectIdField,
  keywordId: z.string().min(1).max(160),
});

export const importOnPageTargetsSchema = z.object({
  projectId: projectIdField,
});

export const estimateOnPageRunSchema = z.object({
  projectId: projectIdField,
});

export const runOnPageCheckerSchema = z.object({
  projectId: projectIdField,
  // Approved ceiling from the estimate step. Fail-closed like the gap services:
  // omitting it means no approval, so a direct API caller cannot skip the quote.
  maxCostCredits: z.number().int().min(0).optional(),
});

export const onPageBucketSchema = z.enum(ON_PAGE_BUCKETS);
export const onPageIdeaTypeSchema = z.enum(ON_PAGE_IDEA_TYPES);
export const onPageTargetSourceSchema = z.enum(ON_PAGE_TARGET_SOURCES);
