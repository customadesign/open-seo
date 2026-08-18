import { z } from "zod";
import { classifyAnchorText, type AnchorKind } from "@/shared/backlinks";

export const backlinksAnchorRowSchema = z.object({
  anchor: z.string().nullable(),
  referringDomains: z.number().nullable(),
  backlinks: z.number().nullable(),
  referringPages: z.number().nullable(),
  rank: z.number().nullable(),
  spamScore: z.number().nullable(),
  firstSeen: z.string().nullable(),
  share: z.number(),
  kind: z.enum(["empty", "naked", "generic", "brand", "commercial"]),
  concentrated: z.boolean(),
});

export const backlinksAnchorsResultSchema = z.object({
  target: z.string(),
  displayTarget: z.string(),
  scope: z.enum(["domain", "page"]),
  rows: z.array(backlinksAnchorRowSchema),
  totalCount: z.number().nullable(),
  totalBacklinks: z.number(),
  concentratedAnchors: z.array(z.string()),
  fetchedAt: z.string(),
});

export const backlinksNewLostRowSchema = z.object({
  date: z.string(),
  newBacklinks: z.number().nullable(),
  lostBacklinks: z.number().nullable(),
  newReferringDomains: z.number().nullable(),
  lostReferringDomains: z.number().nullable(),
});

export const backlinksNewLostResultSchema = z.object({
  target: z.string(),
  displayTarget: z.string(),
  groupRange: z.enum(["day", "week"]),
  dateFrom: z.string(),
  dateTo: z.string(),
  rows: z.array(backlinksNewLostRowSchema),
  fetchedAt: z.string(),
});

export const backlinksBulkRowSchema = z.object({
  target: z.string(),
  displayTarget: z.string(),
  authorityScore: z.number().nullable(),
  referringDomains: z.number().nullable(),
  backlinks: z.number().nullable(),
  organicTraffic: z.number().nullable(),
  isPrimary: z.boolean(),
});

export const backlinksBulkResultSchema = z.object({
  rows: z.array(backlinksBulkRowSchema),
  fetchedAt: z.string(),
  fromCache: z.boolean(),
});

export type BacklinksAnchorRow = z.infer<typeof backlinksAnchorRowSchema>;
export type BacklinksAnchorsResult = z.infer<
  typeof backlinksAnchorsResultSchema
>;
export type BacklinksNewLostResult = z.infer<
  typeof backlinksNewLostResultSchema
>;
export type BacklinksBulkRow = z.infer<typeof backlinksBulkRowSchema>;
export type BacklinksBulkResult = z.infer<typeof backlinksBulkResultSchema>;
export type { AnchorKind };

export { classifyAnchorText };
