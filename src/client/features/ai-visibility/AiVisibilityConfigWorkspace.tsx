import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  addAiVisibilityPrompts,
  deleteAiVisibilityConfig,
  getAiVisibilityConfig,
  removeAiVisibilityPrompts,
  updateAiVisibilityConfig,
} from "@/serverFunctions/ai-visibility";
import {
  AI_VISIBILITY_PROVIDERS,
  MAX_PROMPTS_PER_CONFIG,
  type AiVisibilityProvider,
} from "@/shared/ai-visibility";
import {
  AI_VISIBILITY_PROVIDER_LABELS,
  aiVisibilitySkipReasonLabel,
} from "./aiVisibilityUi";
import {
  AiVisibilityRunPanel,
  type AiVisibilityRunEstimate,
} from "./AiVisibilityRunPanel";

type ConfigDetail = Awaited<ReturnType<typeof getAiVisibilityConfig>>;

export function AiVisibilityConfigWorkspace({
  configId,
  projectId,
  readOnly,
}: {
  configId: string;
  projectId: string;
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [promptText, setPromptText] = useState("");
  const [estimate, setEstimate] = useState<AiVisibilityRunEstimate | null>(
    null,
  );
  const detailQuery = useQuery({
    queryKey: ["aiVisibilityConfig", projectId, configId],
    queryFn: () => getAiVisibilityConfig({ data: { projectId, configId } }),
  });
  const detail = detailQuery.data;

  const invalidate = () => {
    setEstimate(null);
    void queryClient.invalidateQueries({
      queryKey: ["aiVisibilityConfig", projectId, configId],
    });
    void queryClient.invalidateQueries({
      queryKey: ["aiVisibilityConfigs", projectId],
    });
  };

  if (detailQuery.isPending || !detail) {
    return (
      <div className="card border border-base-300 bg-base-100">
        <div className="card-body items-center py-16">
          <Loader2 className="size-5 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <TrackerSettings
        detail={detail}
        projectId={projectId}
        readOnly={readOnly}
        onSaved={invalidate}
      />
      <section className="card border border-base-300 bg-base-100">
        <div className="card-body gap-4 p-4">
          <div>
            <h2 className="font-semibold">Prompts</h2>
            <p className="text-xs text-base-content/60">
              {detail.prompts.length}/{MAX_PROMPTS_PER_CONFIG} prompts. Enter
              one prompt per line.
            </p>
          </div>
          {!readOnly ? (
            <PromptEditor
              configId={configId}
              projectId={projectId}
              promptText={promptText}
              setPromptText={setPromptText}
              onChanged={invalidate}
            />
          ) : null}
          <PromptList
            detail={detail}
            projectId={projectId}
            readOnly={readOnly}
            onChanged={invalidate}
          />
        </div>
      </section>
      <AiVisibilityRunPanel
        configId={configId}
        projectId={projectId}
        readOnly={readOnly}
        estimate={estimate}
        setEstimate={setEstimate}
      />
    </div>
  );
}

function TrackerSettings({
  detail,
  projectId,
  readOnly,
  onSaved,
}: {
  detail: ConfigDetail;
  projectId: string;
  readOnly: boolean;
  onSaved: () => void;
}) {
  const [providers, setProviders] = useState<AiVisibilityProvider[]>(
    detail.providers,
  );
  const [schedule, setSchedule] = useState(detail.config.scheduleInterval);
  const [active, setActive] = useState(detail.config.isActive);
  const [ceiling, setCeiling] = useState(
    detail.config.maxCostCredits?.toString() ?? "",
  );
  const skipReason = aiVisibilitySkipReasonLabel(detail.config.lastSkipReason);
  const saveMutation = useMutation({
    mutationFn: () =>
      updateAiVisibilityConfig({
        data: {
          projectId,
          configId: detail.config.id,
          providers,
          scheduleInterval: schedule,
          isActive: active,
          maxCostCredits: ceiling ? Number.parseInt(ceiling, 10) : null,
        },
      }),
    onSuccess: () => {
      onSaved();
      toast.success("AI visibility settings saved");
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not save settings")),
  });
  const deleteMutation = useMutation({
    mutationFn: () =>
      deleteAiVisibilityConfig({
        data: { projectId, configId: detail.config.id },
      }),
    onSuccess: () => {
      onSaved();
      toast.success("AI visibility tracker deleted");
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not delete tracker")),
  });

  const toggleProvider = (provider: AiVisibilityProvider) => {
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((entry) => entry !== provider)
        : [...current, provider],
    );
  };

  return (
    <section className="card border border-base-300 bg-base-100">
      <div className="card-body gap-4 p-4">
        <div>
          <h2 className="text-lg font-semibold">{detail.config.brandName}</h2>
          <p className="text-sm text-base-content/60">{detail.config.domain}</p>
        </div>
        {skipReason ? (
          <div className="alert alert-warning py-2 text-sm">
            <AlertTriangle className="size-4" />
            <span>
              The last scheduled run was skipped — {skipReason}. The schedule
              still advances; fix the cause to resume collection.
            </span>
          </div>
        ) : null}
        <fieldset disabled={readOnly} className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">Providers</p>
            <div className="flex flex-wrap gap-2">
              {AI_VISIBILITY_PROVIDERS.map((provider) => (
                <label key={provider} className="label cursor-pointer gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={providers.includes(provider)}
                    onChange={() => toggleProvider(provider)}
                  />
                  <span className="label-text">
                    {AI_VISIBILITY_PROVIDER_LABELS[provider]}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="form-control">
              <span className="label-text mb-1 text-sm font-medium">
                Schedule
              </span>
              <select
                className="select select-bordered"
                value={schedule}
                onChange={(event) => {
                  const value = event.target.value;
                  if (
                    value === "manual" ||
                    value === "daily" ||
                    value === "weekly" ||
                    value === "monthly"
                  ) {
                    setSchedule(value);
                    if (value === "manual") setActive(false);
                  }
                }}
              >
                <option value="manual">Manual only</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
              </select>
            </label>
            <label className="form-control">
              <span className="label-text mb-1 text-sm font-medium">
                Per-run ceiling (credits)
              </span>
              <input
                className="input input-bordered"
                type="number"
                min={1}
                step={1}
                value={ceiling}
                onChange={(event) => setCeiling(event.target.value)}
              />
            </label>
            <label className="label h-12 cursor-pointer justify-start gap-2 sm:justify-center">
              <input
                type="checkbox"
                className="toggle toggle-warning"
                checked={active}
                disabled={schedule === "manual"}
                onChange={(event) => setActive(event.target.checked)}
              />
              <span className="label-text">Recurring active</span>
            </label>
          </div>
          {active ? (
            <p className="text-xs text-warning">
              Saving authorizes recurring provider spend on this cadence, up to
              the stated credit ceiling per run.
            </p>
          ) : null}
          {!readOnly ? (
            <div className="flex justify-between gap-2">
              <button
                className="btn btn-error btn-outline btn-sm"
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete this AI visibility tracker and its history?",
                    )
                  ) {
                    deleteMutation.mutate();
                  }
                }}
              >
                Delete tracker
              </button>
              <button
                className="btn btn-sm"
                type="button"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                Save settings
              </button>
            </div>
          ) : null}
        </fieldset>
      </div>
    </section>
  );
}

function PromptEditor({
  configId,
  projectId,
  promptText,
  setPromptText,
  onChanged,
}: {
  configId: string;
  projectId: string;
  promptText: string;
  setPromptText: (value: string) => void;
  onChanged: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () =>
      addAiVisibilityPrompts({
        data: {
          projectId,
          configId,
          prompts: promptText
            .split("\n")
            .map((prompt) => prompt.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: (result) => {
      setPromptText("");
      onChanged();
      toast.success(
        `Added ${result.added} prompt${result.added === 1 ? "" : "s"}`,
      );
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not add prompts")),
  });

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <textarea
        className="textarea textarea-bordered min-h-24 flex-1"
        maxLength={MAX_PROMPTS_PER_CONFIG * 501}
        placeholder="What are the best SEO platforms?"
        value={promptText}
        onChange={(event) => setPromptText(event.target.value)}
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={!promptText.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Add prompts
      </button>
    </div>
  );
}

function PromptList({
  detail,
  projectId,
  readOnly,
  onChanged,
}: {
  detail: ConfigDetail;
  projectId: string;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const removeMutation = useMutation({
    mutationFn: (promptId: string) =>
      removeAiVisibilityPrompts({
        data: {
          projectId,
          configId: detail.config.id,
          promptIds: [promptId],
        },
      }),
    onSuccess: onChanged,
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not remove prompt")),
  });

  if (detail.prompts.length === 0) {
    return <p className="text-sm text-base-content/55">No prompts yet.</p>;
  }
  return (
    <ul className="divide-y divide-base-300 rounded-lg border border-base-300">
      {detail.prompts.map((prompt) => (
        <li key={prompt.id} className="flex items-start gap-3 px-3 py-2">
          <span className="min-w-0 flex-1 text-sm">{prompt.prompt}</span>
          {!readOnly ? (
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-square text-error"
              aria-label={`Remove prompt: ${prompt.prompt}`}
              onClick={() => removeMutation.mutate(prompt.id)}
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
