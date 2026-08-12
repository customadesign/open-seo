/* eslint-disable max-lines -- The page keeps its four local-only form panels together so their query invalidation and evidence language cannot drift. */
import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, MapPinned, Network, Play } from "lucide-react";
import { toast } from "sonner";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { IntegrationConnectionCard } from "@/client/features/integrations/IntegrationConnectionCard";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createGeoGridConfig,
  getCitationAudits,
  getGeoGridConfigs,
  getGeoGridHistory,
  getLocalBusinessProfiles,
  getLocalListingStatus,
  runCitationAudit,
  runGeoGrid,
  saveLocalBusinessProfile,
  saveLocalListingConnection,
} from "@/serverFunctions/local-seo";
import type {
  GeoGridConfig,
  LocalBusinessProfile,
  LocalListingConnection,
} from "@/types/schemas/local-seo";

function invalidateLocalSeo(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["local-seo", "profiles", projectId],
    }),
    queryClient.invalidateQueries({
      queryKey: ["local-seo", "listing", projectId],
    }),
    queryClient.invalidateQueries({
      queryKey: ["local-seo", "grids", projectId],
    }),
    queryClient.invalidateQueries({
      queryKey: ["local-seo", "grid-history", projectId],
    }),
    queryClient.invalidateQueries({
      queryKey: ["local-seo", "citations", projectId],
    }),
  ]);
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = true,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "url" | "tel" | "number";
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="form-control">
      <span className="label-text mb-1 text-sm font-medium">{label}</span>
      <input
        className="input input-bordered w-full"
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function BusinessProfileEditor({
  projectId,
  profile,
}: {
  projectId: string;
  profile: LocalBusinessProfile | null;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => ({
    name: profile?.name ?? "",
    addressLine1: profile?.addressLine1 ?? "",
    addressLine2: profile?.addressLine2 ?? "",
    locality: profile?.locality ?? "",
    region: profile?.region ?? "",
    postalCode: profile?.postalCode ?? "",
    countryCode: profile?.countryCode ?? "US",
    phone: profile?.phone ?? "",
    websiteUrl: profile?.websiteUrl ?? "",
    latitude: profile ? String(profile.latitude) : "",
    longitude: profile ? String(profile.longitude) : "",
    googlePlaceId: profile?.googlePlaceId ?? "",
    googleCid: profile?.googleCid ?? "",
  }));
  const set = (name: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [name]: value }));
  const save = useMutation({
    mutationFn: () =>
      saveLocalBusinessProfile({
        data: {
          projectId,
          profileId: profile?.id,
          name: form.name,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2.trim() || null,
          locality: form.locality,
          region: form.region,
          postalCode: form.postalCode,
          countryCode: form.countryCode,
          phone: form.phone,
          websiteUrl: form.websiteUrl,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          googlePlaceId: form.googlePlaceId.trim() || null,
          googleCid: form.googleCid.trim() || null,
          isPrimary: true,
          verifiedAt: profile?.verifiedAt ?? null,
        },
      }),
    onSuccess: async () => {
      await invalidateLocalSeo(queryClient, projectId);
      toast.success("Business profile saved");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (
      !Number.isFinite(Number(form.latitude)) ||
      !Number.isFinite(Number(form.longitude))
    ) {
      toast.error("Enter valid latitude and longitude values");
      return;
    }
    save.mutate();
  };

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">Canonical business profile</h2>
          <p className="text-sm text-base-content/60">
            OpenSEO compares Maps and citation evidence against this NAP record.
          </p>
        </div>
      </div>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
        <Field
          label="Business name"
          value={form.name}
          onChange={(value) => set("name", value)}
        />
        <Field
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={(value) => set("phone", value)}
        />
        <Field
          label="Address"
          value={form.addressLine1}
          onChange={(value) => set("addressLine1", value)}
        />
        <Field
          label="Suite or unit"
          required={false}
          value={form.addressLine2}
          onChange={(value) => set("addressLine2", value)}
        />
        <Field
          label="City"
          value={form.locality}
          onChange={(value) => set("locality", value)}
        />
        <Field
          label="State or region"
          value={form.region}
          onChange={(value) => set("region", value)}
        />
        <Field
          label="Postal code"
          value={form.postalCode}
          onChange={(value) => set("postalCode", value)}
        />
        <Field
          label="Country code"
          value={form.countryCode}
          onChange={(value) => set("countryCode", value.toUpperCase())}
        />
        <Field
          label="Website"
          type="url"
          value={form.websiteUrl}
          onChange={(value) => set("websiteUrl", value)}
          placeholder="https://example.com"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Latitude"
            type="number"
            value={form.latitude}
            onChange={(value) => set("latitude", value)}
          />
          <Field
            label="Longitude"
            type="number"
            value={form.longitude}
            onChange={(value) => set("longitude", value)}
          />
        </div>
        <Field
          label="Google Place ID"
          required={false}
          value={form.googlePlaceId}
          onChange={(value) => set("googlePlaceId", value)}
        />
        <Field
          label="Google CID"
          required={false}
          value={form.googleCid}
          onChange={(value) => set("googleCid", value)}
        />
        <div className="md:col-span-2">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={save.isPending}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            {profile ? "Update profile" : "Save profile"}
          </button>
        </div>
      </form>
    </section>
  );
}

function ListingsConnection({
  projectId,
  profile,
  connection,
}: {
  projectId: string;
  profile: LocalBusinessProfile;
  connection: LocalListingConnection | null;
}) {
  const queryClient = useQueryClient();
  const [ghlLocationId, setGhlLocationId] = useState(
    connection?.ghlLocationId ?? "",
  );
  const [managementUrl, setManagementUrl] = useState(
    connection?.managementUrl ?? "",
  );
  const [engine, setEngine] = useState<"yext" | "uberall" | "unknown">(
    connection?.engine ?? "yext",
  );
  const [status, setStatus] = useState<
    | "setup_required"
    | "provisioning"
    | "active"
    | "attention_required"
    | "canceled"
    | "unavailable"
  >(
    connection?.status === "not_connected"
      ? "setup_required"
      : (connection?.status ?? "setup_required"),
  );
  const save = useMutation({
    mutationFn: () =>
      saveLocalListingConnection({
        data: {
          projectId,
          profileId: profile.id,
          ghlLocationId,
          engine,
          status,
          managementUrl,
          lastError: null,
        },
      }),
    onSuccess: async () => {
      await invalidateLocalSeo(queryClient, projectId);
      toast.success("GoHighLevel Listings connection saved");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <IntegrationConnectionCard
      title="GoHighLevel Listings"
      icon={<Network className="size-4" />}
      status={
        connection?.status === "active"
          ? "connected"
          : connection
            ? "setup_required"
            : "disconnected"
      }
    >
      <p className="mb-4 text-sm text-base-content/70">
        GoHighLevel and its listings provider handle syndication. OpenSEO stores
        the account link and audits the published evidence.
      </p>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label="GHL location ID"
          value={ghlLocationId}
          onChange={setGhlLocationId}
        />
        <Field
          label="Listings management URL"
          type="url"
          value={managementUrl}
          onChange={setManagementUrl}
        />
        <label className="form-control">
          <span className="label-text mb-1 text-sm font-medium">
            Syndication engine
          </span>
          <select
            className="select select-bordered"
            value={engine}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "yext" ||
                value === "uberall" ||
                value === "unknown"
              ) {
                setEngine(value);
              }
            }}
          >
            <option value="yext">Yext</option>
            <option value="uberall">Uberall</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="form-control">
          <span className="label-text mb-1 text-sm font-medium">
            Stored status
          </span>
          <select
            className="select select-bordered"
            value={status}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "setup_required" ||
                value === "provisioning" ||
                value === "active" ||
                value === "attention_required" ||
                value === "canceled" ||
                value === "unavailable"
              ) {
                setStatus(value);
              }
            }}
          >
            <option value="setup_required">Setup required</option>
            <option value="provisioning">Provisioning</option>
            <option value="active">Active</option>
            <option value="attention_required">Attention required</option>
            <option value="canceled">Canceled</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={save.isPending}
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Save connection
          </button>
          {connection?.managementUrl && (
            <SafeExternalLink
              className="btn btn-outline"
              url={connection.managementUrl}
              label="Open in GoHighLevel"
            />
          )}
        </div>
      </form>
      <p className="mt-4 text-xs text-base-content/50">
        Status is stored evidence. OpenSEO does not claim a live GHL or Yext
        status check.
      </p>
    </IntegrationConnectionCard>
  );
}

function rankCellClass(position: number | null) {
  if (position == null) return "bg-base-300 text-base-content/55";
  if (position <= 3) return "bg-success text-success-content";
  if (position <= 10) return "bg-warning text-warning-content";
  if (position <= 20) return "bg-info text-info-content";
  return "bg-error text-error-content";
}

function GeoGridHeatmap({
  projectId,
  runId,
  gridSize,
}: {
  projectId: string;
  runId: string;
  gridSize: number;
}) {
  const detail = useQuery({
    queryKey: ["local-seo", "grid-run", projectId, runId],
    queryFn: () => getGeoGridHistory({ data: { projectId, runId, limit: 1 } }),
  });
  if (detail.isPending) {
    return <div className="skeleton mt-4 aspect-square w-full max-w-64" />;
  }
  const cells = detail.data?.cells ?? [];
  if (cells.length === 0) return null;
  return (
    <div className="mt-4 max-w-64">
      <p className="mb-2 text-xs font-medium text-base-content/60">
        Latest Maps rank grid
      </p>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` }}
        aria-label={`${gridSize} by ${gridSize} Maps rank grid`}
      >
        {cells.map((cell) => (
          <div
            key={cell.id}
            className={`grid aspect-square place-items-center rounded text-xs font-semibold ${rankCellClass(cell.position)}`}
            title={`Grid row ${cell.rowIndex + 1}, column ${cell.columnIndex + 1}: ${cell.position == null ? "not found in top 20" : `rank ${cell.position}`}`}
          >
            {cell.position ?? "—"}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-base-content/50">
        Green 1–3 · amber 4–10 · blue 11–20 · dash not found
      </p>
    </div>
  );
}

function GeoGridPanel({
  projectId,
  profile,
  configs,
  runs,
}: {
  projectId: string;
  profile: LocalBusinessProfile;
  configs: GeoGridConfig[];
  runs: Array<{
    id: string;
    configId: string;
    status: string;
    gridSize: number;
    averageRank: number | null;
    topThreeCoverage: number | null;
    completedAt: string | null;
  }>;
}) {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [gridSize, setGridSize] = useState(5);
  const [radiusMeters, setRadiusMeters] = useState(5000);
  const [scheduleInterval, setScheduleInterval] = useState<
    "manual" | "weekly" | "monthly"
  >("weekly");
  const create = useMutation({
    mutationFn: () =>
      createGeoGridConfig({
        data: {
          projectId,
          profileId: profile.id,
          keyword,
          centerLatitude: profile.latitude,
          centerLongitude: profile.longitude,
          gridSize,
          radiusMeters,
          languageCode: "en",
          device: "mobile",
          scheduleInterval,
        },
      }),
    onSuccess: async () => {
      setKeyword("");
      await invalidateLocalSeo(queryClient, projectId);
      toast.success("Geo-grid tracker created");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const run = useMutation({
    mutationFn: (configId: string) =>
      runGeoGrid({ data: { projectId, configId } }),
    onSuccess: async (result) => {
      await invalidateLocalSeo(queryClient, projectId);
      if (result.started) toast.success("Geo-grid run completed");
      else toast.info("A geo-grid run is already in progress");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const latestRun = (configId: string) =>
    runs.find((candidate) => candidate.configId === configId);

  return (
    <section className="rounded-xl border border-base-300 bg-base-100 p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <MapPinned className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">Geo-grid rank tracking</h2>
          <p className="text-sm text-base-content/60">
            Check Google Maps visibility across a square grid centered on the
            business.
          </p>
        </div>
      </div>
      <form
        className="grid gap-4 md:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div className="md:col-span-2">
          <Field
            label="Keyword"
            value={keyword}
            onChange={setKeyword}
            placeholder="commercial electrician"
          />
        </div>
        <label className="form-control">
          <span className="label-text mb-1 text-sm font-medium">Grid</span>
          <select
            className="select select-bordered"
            value={gridSize}
            onChange={(event) => setGridSize(Number(event.target.value))}
          >
            <option value={3}>3 × 3 (9 lookups)</option>
            <option value={5}>5 × 5 (25 lookups)</option>
            <option value={7}>7 × 7 (49 lookups)</option>
          </select>
        </label>
        <Field
          label="Radius in meters"
          type="number"
          value={String(radiusMeters)}
          onChange={(value) => setRadiusMeters(Number(value))}
        />
        <label className="form-control md:col-span-2">
          <span className="label-text mb-1 text-sm font-medium">Schedule</span>
          <select
            className="select select-bordered"
            value={scheduleInterval}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "manual" ||
                value === "weekly" ||
                value === "monthly"
              ) {
                setScheduleInterval(value);
              }
            }}
          >
            <option value="manual">Manual only</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <div className="flex items-end md:col-span-2">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={create.isPending}
          >
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            Add tracker
          </button>
        </div>
      </form>
      <p className="mt-3 text-xs text-warning">
        Each grid cell is one metered live DataForSEO Maps lookup. Run buttons
        are explicit so costs stay visible.
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {configs.length === 0 && (
          <p className="text-sm text-base-content/60">
            No geo-grid trackers yet.
          </p>
        )}
        {configs.map((config) => {
          const recent = latestRun(config.id);
          return (
            <article
              key={config.id}
              className="rounded-lg border border-base-300 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-medium">{config.keyword}</h3>
                  <p className="text-xs text-base-content/60">
                    {config.gridSize} × {config.gridSize},{" "}
                    {(config.radiusMeters / 1000).toFixed(1)} km,{" "}
                    {config.scheduleInterval}
                  </p>
                </div>
                <button
                  className="btn btn-outline btn-sm"
                  type="button"
                  disabled={run.isPending}
                  onClick={() => run.mutate(config.id)}
                >
                  {run.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  Run
                </button>
              </div>
              {recent && (
                <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-base-content/50">Status</dt>
                    <dd className="capitalize">{recent.status}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-base-content/50">
                      Average rank
                    </dt>
                    <dd>{recent.averageRank?.toFixed(1) ?? "Not found"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-base-content/50">
                      Top 3 coverage
                    </dt>
                    <dd>
                      {recent.topThreeCoverage == null
                        ? "—"
                        : `${Math.round(recent.topThreeCoverage * 100)}%`}
                    </dd>
                  </div>
                </dl>
              )}
              {recent?.status === "completed" && (
                <GeoGridHeatmap
                  projectId={projectId}
                  runId={recent.id}
                  gridSize={recent.gridSize}
                />
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function LocalSeoPage({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const profiles = useQuery({
    queryKey: ["local-seo", "profiles", projectId],
    queryFn: () => getLocalBusinessProfiles({ data: { projectId } }),
  });
  const listing = useQuery({
    queryKey: ["local-seo", "listing", projectId],
    queryFn: () => getLocalListingStatus({ data: { projectId } }),
  });
  const grids = useQuery({
    queryKey: ["local-seo", "grids", projectId],
    queryFn: () => getGeoGridConfigs({ data: { projectId } }),
  });
  const history = useQuery({
    queryKey: ["local-seo", "grid-history", projectId],
    queryFn: () => getGeoGridHistory({ data: { projectId, limit: 50 } }),
  });
  const citations = useQuery({
    queryKey: ["local-seo", "citations", projectId],
    queryFn: () => getCitationAudits({ data: { projectId, limit: 20 } }),
  });
  const profile =
    profiles.data?.find((candidate) => candidate.isPrimary) ??
    profiles.data?.[0] ??
    null;
  const citationRun = useMutation({
    mutationFn: () =>
      runCitationAudit({
        data: {
          projectId,
          profileId: profile?.id,
          radiusKm: 5,
          resultLimit: 20,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["local-seo", "citations", projectId],
      });
      toast.success("Google Business citation evidence checked.");
    },
    onError: (mutationError) =>
      toast.error(getStandardErrorMessage(mutationError)),
  });
  const pending =
    profiles.isPending ||
    listing.isPending ||
    grids.isPending ||
    history.isPending ||
    citations.isPending;
  const error =
    profiles.error ??
    listing.error ??
    grids.error ??
    history.error ??
    citations.error;
  if (pending) {
    return (
      <div className="grid min-h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-base-content/40" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <div className="alert alert-error">
          {getStandardErrorMessage(error)}
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Local SEO</h1>
          <p className="text-sm text-base-content/70">
            Track Maps visibility, audit citation evidence, and connect the
            client's GoHighLevel Listings account.
          </p>
        </header>
        <BusinessProfileEditor
          key={profile?.id ?? "new-profile"}
          projectId={projectId}
          profile={profile}
        />
        {profile && (
          <>
            <ListingsConnection
              key={listing.data?.connection?.id ?? "new-listing"}
              projectId={projectId}
              profile={profile}
              connection={listing.data?.connection ?? null}
            />
            <GeoGridPanel
              projectId={projectId}
              profile={profile}
              configs={grids.data ?? []}
              runs={history.data?.runs ?? []}
            />
            <section className="rounded-xl border border-base-300 bg-base-100 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Citation audit history</h2>
                  <p className="mt-1 text-sm text-base-content/60">
                    The DataForSEO run checks Google Business only. Other
                    directories need supplied evidence and remain explicitly
                    unverified until checked.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={citationRun.isPending}
                  onClick={() => citationRun.mutate()}
                >
                  {citationRun.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Network className="size-4" />
                  )}
                  Check Google Business
                </button>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Match</th>
                      <th>Mismatch</th>
                      <th>Unverified</th>
                      <th>Not found</th>
                      <th>Blocked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(citations.data?.runs ?? []).map((run) => (
                      <tr key={run.id}>
                        <td>{run.startedAt.slice(0, 10)}</td>
                        <td>{run.confirmedMatches}</td>
                        <td>{run.confirmedMismatches}</td>
                        <td>{run.foundUnverified}</td>
                        <td>{run.notFound}</td>
                        <td>{run.blocked}</td>
                      </tr>
                    ))}
                    {(citations.data?.runs.length ?? 0) === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="text-center text-base-content/50"
                        >
                          No citation audits yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
