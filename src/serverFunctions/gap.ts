import { createServerFn } from "@tanstack/react-start";
import { requireProjectUse } from "@/serverFunctions/middleware";
import { resolveLabsMarket } from "@/shared/keyword-locations";
import { KeywordGapService } from "@/server/features/gap/services/KeywordGapService";
import { BacklinkGapService } from "@/server/features/gap/services/BacklinkGapService";
import {
  backlinkGapCompareSchema,
  backlinkGapResultsSchema,
  backlinkGapRunSchema,
  keywordGapCompareSchema,
  keywordGapResultsSchema,
  keywordGapRunSchema,
} from "@/types/schemas/gap";

export const estimateKeywordGap = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(keywordGapCompareSchema)
  .handler(async ({ data, context }) => {
    const market = resolveLabsMarket(data, context.project);
    return KeywordGapService.estimate(
      {
        ...data,
        ...market,
        projectId: context.projectId,
      },
      context,
    );
  });

export const runKeywordGap = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(keywordGapRunSchema)
  .handler(async ({ data, context }) => {
    const market = resolveLabsMarket(data, context.project);
    return KeywordGapService.run(
      {
        ...data,
        ...market,
        projectId: context.projectId,
      },
      context,
    );
  });

export const getKeywordGapResults = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(keywordGapResultsSchema)
  .handler(async ({ data, context }) =>
    KeywordGapService.getResults({
      projectId: context.projectId,
      runId: data.runId,
      filters: data.filters,
    }),
  );

export const estimateBacklinkGap = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(backlinkGapCompareSchema)
  .handler(async ({ data, context }) =>
    BacklinkGapService.estimate(
      {
        ...data,
        projectId: context.projectId,
      },
      context,
    ),
  );

export const runBacklinkGap = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(backlinkGapRunSchema)
  .handler(async ({ data, context }) =>
    BacklinkGapService.run(
      {
        ...data,
        projectId: context.projectId,
      },
      context,
    ),
  );

export const getBacklinkGapResults = createServerFn({ method: "POST" })
  .middleware(requireProjectUse)
  .validator(backlinkGapResultsSchema)
  .handler(async ({ data, context }) =>
    BacklinkGapService.getResults({
      projectId: context.projectId,
      runId: data.runId,
    }),
  );
