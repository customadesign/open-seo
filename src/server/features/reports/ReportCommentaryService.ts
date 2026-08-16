import { generateText, Output } from "ai";
import { z } from "zod";
import { getChatAgentModel } from "@/server/lib/openrouter";
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
): Promise<ReportCommentary[]> {
  const deterministic = fallback(snapshot);
  try {
    const allowedKeys = new Set(snapshot.evidence.map((item) => item.key));
    const { output } = await generateText({
      model: await getChatAgentModel(),
      output: Output.object({ schema: commentaryOutputSchema }),
      system:
        "Write a concise monthly marketing report for a client. Use only the supplied evidence. Do not invent causes, results, or recommendations. Keep the language plain and specific.",
      prompt: JSON.stringify({
        period: snapshot.period,
        comparisonPeriod: snapshot.comparisonPeriod,
        evidence: snapshot.evidence,
        requiredKinds: ["overview", "win", "watch", "next_step"],
      }),
      maxOutputTokens: 1_000,
    });
    if (!output) return deterministic;
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
  } catch (error) {
    console.warn("report.commentary_fallback", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return deterministic;
  }
}
