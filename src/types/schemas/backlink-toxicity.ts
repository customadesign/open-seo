import { z } from "zod";
import { TOXIC_MARKER_CODES } from "@/shared/backlink-toxicity";

export const toxicMarkerSchema = z.object({
  code: z.enum(TOXIC_MARKER_CODES),
  points: z.number().int(),
  detail: z.string(),
});

export const runBacklinkToxicityAuditSchema = z.object({
  projectId: z.string().min(1),
  target: z.string().trim().min(1).max(2048),
  scope: z.enum(["domain", "page"]).optional(),
});

export const getBacklinkToxicityAuditSchema = z.object({
  projectId: z.string().min(1),
});

export const backlinkToxicityDomainActionSchema = z.object({
  projectId: z.string().min(1),
  domain: z.string().trim().min(1).max(253),
});

export type RunBacklinkToxicityAuditInput = z.infer<
  typeof runBacklinkToxicityAuditSchema
>;
export type BacklinkToxicityDomainActionInput = z.infer<
  typeof backlinkToxicityDomainActionSchema
>;
export type ToxicMarkerInput = z.infer<typeof toxicMarkerSchema>;
