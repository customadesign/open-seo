import { z } from "zod";

export const disavowEntryTypeSchema = z.enum(["domain", "url"]);
export const disavowStatusSchema = z.enum([
  "pending",
  "kept",
  "removal_requested",
  "disavowed",
  "exported",
]);
export const disavowSourceSchema = z.enum([
  "manual",
  "semrush_csv",
  "google_txt",
]);

export const listDisavowEntriesSchema = z.object({
  projectId: z.string().min(1),
});

export const saveDisavowEntrySchema = listDisavowEntriesSchema.extend({
  id: z.string().min(1).optional(),
  entryType: disavowEntryTypeSchema,
  value: z.string().trim().min(1).max(2048),
  status: disavowStatusSchema.default("pending"),
  comments: z.string().trim().max(2000).nullable().default(null),
  linkCount: z.number().int().min(0).max(2_147_483_647).default(0),
});

export const deleteDisavowEntrySchema = listDisavowEntriesSchema.extend({
  id: z.string().min(1),
});

export const importDisavowEntriesSchema = listDisavowEntriesSchema.extend({
  format: z.enum(["semrush_csv", "google_txt"]),
  content: z.string().min(1).max(2_000_000),
});

export type DisavowEntryType = z.infer<typeof disavowEntryTypeSchema>;
export type DisavowStatus = z.infer<typeof disavowStatusSchema>;
export type DisavowSource = z.infer<typeof disavowSourceSchema>;
export type SaveDisavowEntryInput = z.infer<typeof saveDisavowEntrySchema>;
export type ImportDisavowEntriesInput = z.infer<
  typeof importDisavowEntriesSchema
>;
