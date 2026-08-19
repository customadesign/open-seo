import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GoogleGlyph } from "@/client/features/gsc/GoogleGlyph";
import { GoogleOAuthSetupWarning } from "@/client/features/integrations/GoogleOAuthSetupWarning";
import { IntegrationConnectionCard } from "@/client/features/integrations/IntegrationConnectionCard";
import { GoogleAdsLogo } from "@/client/features/integrations/GoogleProductLogos";
import { startGoogleLink } from "@/client/features/integrations/startGoogleLink";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  disconnectGoogleAds,
  getGoogleAdsConnection,
  listGoogleAdsCustomers,
  setGoogleAdsCustomer,
} from "@/serverFunctions/google-ads";
import { GOOGLE_ADS_SELF_HOSTED_SETUP_DOCS_URL } from "@/shared/google-ads";

type Selection = { accountId: string; customerId: string };

export function GoogleAdsConnectionCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = React.useState(false);
  const [selection, setSelection] = React.useState<Selection | null>(null);
  const connectionKey = ["googleAdsConnection", projectId];
  const connectionQuery = useQuery({
    queryKey: connectionKey,
    queryFn: () => getGoogleAdsConnection({ data: { projectId } }),
  });
  const connection = connectionQuery.data;
  const connected = Boolean(connection?.connected);
  const showPicker =
    picking || Boolean(connection?.currentUserHasGrant && !connected);
  const customerQuery = useQuery({
    queryKey: ["googleAdsCustomers", projectId],
    queryFn: () => listGoogleAdsCustomers({ data: { projectId } }),
    enabled: Boolean(showPicker && connection?.configured),
  });

  React.useEffect(() => {
    if (selection) return;
    for (const account of customerQuery.data?.accounts ?? []) {
      const selected = account.customers.find(
        (customer) => customer.isSelected,
      );
      if (selected) {
        setSelection({
          accountId: account.accountId,
          customerId: selected.customerId,
        });
        return;
      }
    }
  }, [customerQuery.data, selection]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: connectionKey });
    void queryClient.invalidateQueries({
      queryKey: ["googleAdsCustomers", projectId],
    });
  };
  const saveMutation = useMutation({
    mutationFn: (value: Selection) =>
      setGoogleAdsCustomer({ data: { projectId, ...value } }),
    onSuccess: () => {
      toast.success("Google Ads connected");
      setPicking(false);
      refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const disconnectMutation = useMutation({
    mutationFn: () => disconnectGoogleAds({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Google Ads disconnected");
      setSelection(null);
      setPicking(false);
      refresh();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <IntegrationConnectionCard
      title="Google Ads"
      icon={<GoogleAdsLogo className="size-5" />}
      status={
        connectionQuery.isLoading
          ? undefined
          : !connection?.configured
            ? "setup_required"
            : connected
              ? "connected"
              : "disconnected"
      }
    >
      {connectionQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-base-content/50">
          <span className="loading loading-spinner loading-sm" />
          Checking…
        </div>
      ) : !connection?.configured ? (
        <GoogleOAuthSetupWarning
          integrationName="Google Ads"
          docsUrl={GOOGLE_ADS_SELF_HOSTED_SETUP_DOCS_URL}
        />
      ) : connected && !picking ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-base-300 bg-base-200/30 px-4 py-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-base-content/45">
              Selected account
            </p>
            <p className="mt-0.5 text-sm font-semibold">
              {connection.customerName}
            </p>
            <p className="mt-1 text-xs text-base-content/55">
              ID {formatCustomerId(connection.customerId ?? "")} ·{" "}
              {connection.currencyCode} · {connection.timeZone}
            </p>
            {connection.connectedByEmail ? (
              <p className="mt-1 text-xs text-base-content/55">
                Connected by {connection.connectedByEmail}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setPicking(true)}
            >
              Change account
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm text-error"
              disabled={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate()}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : showPicker ? (
        <CustomerPicker
          loading={customerQuery.isLoading}
          error={customerQuery.isError}
          accounts={customerQuery.data?.accounts ?? []}
          selection={selection}
          onSelect={setSelection}
          onSave={() => selection && saveMutation.mutate(selection)}
          saving={saveMutation.isPending}
          onCancel={connected ? () => setPicking(false) : undefined}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-base-content/70">
            Connect a Google Ads account to include spend, traffic, conversions,
            and campaign results in monthly reports.
          </p>
          <button
            type="button"
            className="inline-flex items-center gap-2.5 rounded-lg border border-base-300 bg-base-100 px-4 py-2.5 text-sm font-semibold shadow-sm transition hover:bg-base-200"
            onClick={() =>
              void startGoogleLink("googleAds", window.location.href)
            }
          >
            <GoogleGlyph className="size-[18px]" />
            Connect with Google
          </button>
        </div>
      )}
    </IntegrationConnectionCard>
  );
}

function CustomerPicker({
  loading,
  error,
  accounts,
  selection,
  onSelect,
  onSave,
  saving,
  onCancel,
}: {
  loading: boolean;
  error: boolean;
  accounts: Array<{
    accountId: string;
    email: string | null;
    requiresReconnect: boolean;
    customersUnavailable: boolean;
    customers: Array<{ customerId: string; descriptiveName: string }>;
  }>;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  onSave: () => void;
  saving: boolean;
  onCancel?: () => void;
}) {
  if (loading) return <span className="loading loading-spinner loading-sm" />;
  if (error)
    return (
      <p className="text-sm text-error">Could not load Google Ads accounts.</p>
    );
  const options = accounts.flatMap((account) =>
    account.customers.map((customer) => ({
      ...customer,
      accountId: account.accountId,
      email: account.email,
    })),
  );
  const value = selection
    ? `${selection.accountId}:${selection.customerId}`
    : "";
  const reconnectRequired =
    accounts.length > 0 &&
    accounts.every((account) => account.requiresReconnect);
  if (reconnectRequired) {
    return (
      <button
        type="button"
        className="btn btn-outline btn-sm"
        onClick={() => void startGoogleLink("googleAds", window.location.href)}
      >
        Reconnect with Google
      </button>
    );
  }
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">
          Serving account
        </span>
        <select
          className="select select-bordered w-full"
          value={value}
          onChange={(event) => {
            const [accountId, customerId] = event.target.value.split(":");
            if (accountId && customerId) onSelect({ accountId, customerId });
          }}
        >
          <option value="" disabled>
            Select an account…
          </option>
          {options.map((option) => (
            <option
              key={`${option.accountId}:${option.customerId}`}
              value={`${option.accountId}:${option.customerId}`}
            >
              {option.descriptiveName} · {formatCustomerId(option.customerId)}
            </option>
          ))}
        </select>
      </label>
      {options.length === 0 ? (
        <p className="text-sm text-base-content/60">
          No serving accounts are available for this Google login.
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!selection || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save account"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() =>
            void startGoogleLink("googleAds", window.location.href)
          }
        >
          Connect another Google account
        </button>
        {onCancel ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function formatCustomerId(customerId: string) {
  return customerId.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
}
