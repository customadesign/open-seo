import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceAccess } from "@/client/features/auth/useWorkspaceAccess";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createAiVisibilityConfig,
  getAiVisibilityConfigs,
} from "@/serverFunctions/ai-visibility";
import { AiVisibilityConfigWorkspace } from "./AiVisibilityConfigWorkspace";
import { aiVisibilitySkipReasonLabel } from "./aiVisibilityUi";

type ConfigRow = Awaited<ReturnType<typeof getAiVisibilityConfigs>>[number];

export function AiVisibilityPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const accessQuery = useWorkspaceAccess();
  const readOnly = accessQuery.data?.role === "client";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const [domain, setDomain] = useState("");

  const configsQuery = useQuery({
    queryKey: ["aiVisibilityConfigs", projectId],
    queryFn: () => getAiVisibilityConfigs({ data: { projectId } }),
  });
  const configs = useMemo(() => configsQuery.data ?? [], [configsQuery.data]);

  useEffect(() => {
    if (!selectedId && configs[0]) setSelectedId(configs[0].id);
    if (selectedId && !configs.some((config) => config.id === selectedId)) {
      setSelectedId(configs[0]?.id ?? null);
    }
  }, [configs, selectedId]);

  const createMutation = useMutation({
    mutationFn: () =>
      createAiVisibilityConfig({
        data: {
          projectId,
          brandName,
          domain,
          providers: [],
          scheduleInterval: "manual",
          isActive: false,
        },
      }),
    onSuccess: (detail) => {
      setBrandName("");
      setDomain("");
      setSelectedId(detail.config.id);
      void queryClient.invalidateQueries({
        queryKey: ["aiVisibilityConfigs", projectId],
      });
      toast.success("AI visibility tracker created — provider spend is off");
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Could not create tracker")),
  });

  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header>
          <h1 className="text-2xl font-semibold">AI Visibility</h1>
          <p className="mt-1 text-sm text-base-content/70">
            Track observable brand mentions and citations in ChatGPT Search,
            Gemini, and Google AI Mode. OpenSEO does not invent a composite
            visibility score.
          </p>
        </header>

        <div className="alert alert-warning text-sm">
          <AlertTriangle className="size-4" />
          <span>
            New trackers are inactive and manual. A run starts only after you
            review its estimate and approve that exact credit ceiling.
          </span>
        </div>

        {!readOnly ? (
          <form
            className="card border border-base-300 bg-base-100"
            onSubmit={(event) => {
              event.preventDefault();
              if (!brandName.trim() || !domain.trim()) {
                toast.error("Enter a brand name and domain");
                return;
              }
              createMutation.mutate();
            }}
          >
            <div className="card-body gap-3 p-4">
              <h2 className="text-sm font-semibold">New tracker</h2>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <input
                  className="input input-bordered w-full"
                  aria-label="Brand name"
                  placeholder="Brand name"
                  maxLength={200}
                  value={brandName}
                  onChange={(event) => setBrandName(event.target.value)}
                />
                <input
                  className="input input-bordered w-full"
                  aria-label="Brand domain"
                  placeholder="example.com"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                />
                <button
                  className="btn btn-primary gap-1"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Add tracker
                </button>
              </div>
            </div>
          </form>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="card h-fit border border-base-300 bg-base-100">
            <div className="card-body gap-2 p-3">
              <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-base-content/55">
                Trackers
              </h2>
              {configsQuery.isPending ? (
                <Loader2 className="m-3 size-4 animate-spin" />
              ) : configs.length === 0 ? (
                <p className="px-2 py-4 text-sm text-base-content/60">
                  No AI visibility trackers yet.
                </p>
              ) : (
                configs.map((config) => (
                  <ConfigButton
                    key={config.id}
                    config={config}
                    selected={selectedId === config.id}
                    onSelect={() => setSelectedId(config.id)}
                  />
                ))
              )}
            </div>
          </aside>

          {selectedId ? (
            <AiVisibilityConfigWorkspace
              key={selectedId}
              configId={selectedId}
              projectId={projectId}
              readOnly={readOnly}
            />
          ) : (
            <div className="card border border-base-300 bg-base-100">
              <div className="card-body items-center justify-center py-16 text-sm text-base-content/60">
                Create a tracker to add prompts and collect observations.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigButton({
  config,
  selected,
  onSelect,
}: {
  config: ConfigRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const skipReason = aiVisibilitySkipReasonLabel(config.lastSkipReason);
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-2 text-left ${
        selected ? "bg-primary/10 text-primary" : "hover:bg-base-200"
      }`}
      onClick={onSelect}
    >
      <span className="block truncate text-sm font-medium">
        {config.brandName}
      </span>
      <span className="block truncate text-xs opacity-65">{config.domain}</span>
      <span className="mt-1 block text-[11px] uppercase tracking-wide opacity-55">
        {config.isActive ? config.scheduleInterval : "Manual / inactive"}
      </span>
      {skipReason ? (
        <span className="mt-1 flex items-center gap-1 text-[11px] text-warning">
          <AlertTriangle className="size-3 shrink-0" />
          Last scheduled run skipped — {skipReason}
        </span>
      ) : null}
    </button>
  );
}
