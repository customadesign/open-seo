import { generateText } from "ai";
import { z } from "zod";
import {
  assertUsageCreditsAvailable,
  trackUsageCreditSpend,
} from "@/server/billing/subscription";
import { AppError } from "@/server/lib/errors";
import { openRouterCostUsd } from "@/server/lib/openrouter-usage";
import { getChatAgentModel } from "@/server/lib/openrouter";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import type {
  ReportCommentaryKind,
  ReportSnapshot,
} from "@/types/schemas/reports";

type ReportCommentary = {
  kind: ReportCommentaryKind;
  text: string;
  evidenceKey: string | null;
  isGenerated: boolean;
};

const commentaryOutputSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["overview", "win", "watch", "next_step"]),
        text: z.string().min(1).max(600),
        evidenceKey: z.string().nullable(),
      }),
    )
    .min(4)
    .max(8),
});

const REQUIRED_COMMENTARY_KINDS = [
  "overview",
  "win",
  "watch",
  "next_step",
] as const satisfies readonly ReportCommentaryKind[];

function fallback(snapshot: ReportSnapshot): ReportCommentary[] {
  const positive = snapshot.evidence.find(
    (item) => item.direction === "positive",
  );
  const negative = snapshot.evidence.find(
    (item) => item.direction === "negative",
  );
  const first = snapshot.evidence[0];
  const overview =
    snapshot.evidence.length > 0
      ? `This report covers ${snapshot.period.start} through ${snapshot.period.end}. The main measures are included below with comparisons to the preceding period.`
      : `This report covers ${snapshot.period.start} through ${snapshot.period.end}. Connected sources did not return enough evidence for a detailed summary.`;
  return [
    {
      kind: "overview",
      text: overview,
      evidenceKey: first?.key ?? null,
      isGenerated: true,
    },
    {
      kind: "win",
      text: positive
        ? `${positive.label}: ${positive.value}.`
        : "No clear positive movement stood out this period.",
      evidenceKey: positive?.key ?? null,
      isGenerated: true,
    },
    {
      kind: "watch",
      text: negative
        ? `${negative.label}: ${negative.value}.`
        : "No material decline stood out in the available data.",
      evidenceKey: negative?.key ?? null,
      isGenerated: true,
    },
    {
      kind: "next_step",
      text: negative
        ? `Review the work tied to ${negative.label.toLowerCase()} and document one corrective action for the next reporting period.`
        : "Choose one measurable action from the report and record it for the next monthly comparison.",
      evidenceKey: negative?.key ?? first?.key ?? null,
      isGenerated: true,
    },
  ];
}

export async function generateReportCommentary(
  snapshot: ReportSnapshot,
  context: {
    organizationId: string;
    projectId: string;
    runId: string;
    trigger: "manual" | "scheduled";
  },
): Promise<ReportCommentary[]> {
  const deterministic = fallback(snapshot);
  const hosted = await isHostedServerAuthMode();
  // A self-hosted schedule is a standing authorization to assemble a report,
  // not an open-ended authorization to call an LLM. Hosted schedules are
  // bounded by product credits below; self-hosted scheduled runs use the
  // deterministic evidence summary until a separately reviewed provider-cost
  // ceiling exists.
  if (!hosted && context.trigger === "scheduled") return deterministic;
  let monthlyRemaining: number | null = null;
  if (hosted) {
    try {
      ({ monthlyRemaining } = await assertUsageCreditsAvailable(
        context.organizationId,
      ));
    } catch (error) {
      if (error instanceof AppError && error.code === "INSUFFICIENT_CREDITS") {
        return deterministic;
      }
      throw error;
    }
  }

  let generated: { text: string; providerMetadata?: unknown };
  try {
    generated = await generateText({
      model: await getChatAgentModel(),
      system:
        'Write a concise monthly marketing report for a client. Use only the supplied evidence. Do not invent causes, results, or recommendations. Keep the language plain and specific. Return only one valid JSON object shaped exactly as {"items":[{"kind":"overview|win|watch|next_step","text":"plain client-facing sentence","evidenceKey":"matching evidence key or null"}]}. Include at least one item of each kind, spell next_step with the underscore, always include evidenceKey, and do not use Markdown fences.',
      prompt: JSON.stringify({
        period: snapshot.period,
        comparisonPeriod: snapshot.comparisonPeriod,
        evidence: snapshot.evidence,
        requiredKinds: ["overview", "win", "watch", "next_step"],
      }),
      maxOutputTokens: 2_000,
    });
  } catch (error) {
    console.warn("report.commentary_fallback", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return deterministic;
  }

  if (monthlyRemaining !== null) {
    await trackUsageCreditSpend({
      customer: {
        userId: context.organizationId,
        userEmail: "system-reports@openseo.so",
        organizationId: context.organizationId,
        projectId: context.projectId,
      },
      customerId: context.organizationId,
      creditFeature: "reports",
      costUsd: openRouterCostUsd(generated.providerMetadata),
      monthlyRemaining,
      properties: {
        provider: "openrouter",
        report_run_id: context.runId,
        trigger: context.trigger,
      },
    });
  }

  let rawOutput: unknown;
  try {
    const trimmed = generated.text.trim();
    const jsonText = trimmed.startsWith("```")
      ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
      : trimmed;
    rawOutput = JSON.parse(jsonText);
  } catch {
    return deterministic;
  }
  const parsedOutput = commentaryOutputSchema.safeParse(rawOutput);
  if (!parsedOutput.success) return deterministic;
  const output = parsedOutput.data;
  const allowedKeys = new Set(snapshot.evidence.map((item) => item.key));
  const kinds = new Set(output.items.map((item) => item.kind));
  if (!REQUIRED_COMMENTARY_KINDS.every((kind) => kinds.has(kind))) {
    return deterministic;
  }
  return output.items.map((item) => ({
    ...item,
    evidenceKey:
      item.evidenceKey && allowedKeys.has(item.evidenceKey)
        ? item.evidenceKey
        : null,
    isGenerated: true,
  }));
}
