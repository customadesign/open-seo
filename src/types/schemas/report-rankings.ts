import { z } from "zod";

export const rankBandCountSchema = z.object({
  top3: z.number().int(),
  top4to10: z.number().int(),
  top11to20: z.number().int(),
  top21to100: z.number().int(),
  notInTop100: z.number().int(),
});

export const rankBandMoveSchema = z.object({
  entered: z.number().int(),
  left: z.number().int(),
});

const rankDeviceSchema = z.enum(["desktop", "mobile"]);

export const cannibalizationSchema = z.object({
  sameSerp: z
    .array(
      z.object({
        keyword: z.string(),
        device: rankDeviceSchema,
        currentPosition: z.number().nullable(),
        urls: z.array(
          z.object({ url: z.string(), position: z.number().int() }),
        ),
      }),
    )
    .optional(),
  findings: z.array(
    z.object({
      keyword: z.string(),
      device: rankDeviceSchema,
      currentPosition: z.number().nullable(),
      currentUrl: z.string().nullable(),
      transitionCount: z.number().int(),
      competingUrls: z.array(
        z.object({ url: z.string(), snapshotCount: z.number().int() }),
      ),
    }),
  ),
  scannedKeywords: z.number().int(),
  capturedRunCount: z.number().int().optional(),
});
