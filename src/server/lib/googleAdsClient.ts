import { getAuth } from "@/lib/auth";
import { z } from "zod";
import { getRequiredEnvValue } from "@/server/lib/runtime-env";
import { GOOGLE_ADS_OAUTH_PROVIDER_ID } from "@/shared/google-ads";
import { GoogleAdsApiError, GoogleAdsTokenError } from "./googleAdsErrors";

const GOOGLE_ADS_API_VERSION = "v25";
const GOOGLE_ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

type GoogleAdsCustomer = {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  manager: boolean;
  loginCustomerId: string | null;
};

type GoogleAdsSearchResponse = {
  results?: Array<Record<string, unknown>>;
  nextPageToken?: string;
};

function cleanCustomerId(value: string): string {
  return value.replaceAll("-", "").replace(/^customers\//, "");
}

function messageForStatus(status: number, body: string): string {
  if (status === 401)
    return "Google Ads authorization expired. Reconnect the Google account.";
  if (status === 403)
    return "Google Ads denied this request. Check the developer token and account access.";
  if (status === 429) return "Google Ads rate limit reached. Retry shortly.";
  return `Google Ads API error (${status}): ${body.slice(0, 300)}`;
}

function readObject(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).safeParse(value).data ?? {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

export function createGoogleAdsClient(opts: {
  userId: string;
  googleAdsAccountId: string;
}) {
  async function getToken(): Promise<string> {
    try {
      const result = await getAuth().api.getAccessToken({
        body: {
          providerId: GOOGLE_ADS_OAUTH_PROVIDER_ID,
          userId: opts.userId,
          accountId: opts.googleAdsAccountId,
        },
      });
      if (result?.accessToken) return result.accessToken;
    } catch (error) {
      throw new GoogleAdsTokenError(
        "Could not mint a Google Ads access token.",
        { cause: error },
      );
    }
    throw new GoogleAdsTokenError("Google Ads returned no access token.");
  }

  async function request<T>(
    url: string,
    input?: {
      method?: string;
      body?: unknown;
      loginCustomerId?: string | null;
    },
  ): Promise<T> {
    const [token, developerToken] = await Promise.all([
      getToken(),
      getRequiredEnvValue("GOOGLE_ADS_DEVELOPER_TOKEN"),
    ]);
    const response = await fetch(url, {
      method: input?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": developerToken,
        ...(input?.loginCustomerId
          ? { "login-customer-id": cleanCustomerId(input.loginCustomerId) }
          : {}),
        ...(input?.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: input?.body === undefined ? undefined : JSON.stringify(input.body),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GoogleAdsApiError(
        response.status,
        messageForStatus(response.status, body),
        body,
      );
    }
    return (await response.json()) as T;
  }

  async function search(
    customerId: string,
    query: string,
    loginCustomerId?: string | null,
  ): Promise<Array<Record<string, unknown>>> {
    const results: Array<Record<string, unknown>> = [];
    let pageToken: string | undefined;
    do {
      const response = await request<GoogleAdsSearchResponse>(
        `${GOOGLE_ADS_API_BASE}/customers/${cleanCustomerId(customerId)}/googleAds:search`,
        {
          method: "POST",
          loginCustomerId,
          body: {
            query,
            pageSize: 10_000,
            ...(pageToken ? { pageToken } : {}),
          },
        },
      );
      results.push(...(response.results ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);
    return results;
  }

  async function listDirectCustomers(
    customerId: string,
    loginCustomerId: string | null,
  ): Promise<GoogleAdsCustomer[]> {
    const rows = await search(
      customerId,
      `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.level, customer_client.status FROM customer_client WHERE customer_client.level <= 1`,
      loginCustomerId,
    );
    return rows
      .map((row) => readObject(row.customerClient))
      .filter((customer) => readString(customer.status) !== "CANCELED")
      .map((customer) => ({
        customerId: cleanCustomerId(readString(customer.id)),
        descriptiveName:
          readString(customer.descriptiveName) ||
          `Customer ${readString(customer.id)}`,
        currencyCode: readString(customer.currencyCode),
        timeZone: readString(customer.timeZone),
        manager: readBoolean(customer.manager),
        loginCustomerId,
      }))
      .filter((customer) => customer.customerId);
  }

  return {
    search,
    async getUserInfoEmail(): Promise<string | null> {
      const token = await getToken();
      const response = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return null;
      const body = await response.json<{ email?: unknown }>();
      return typeof body.email === "string" ? body.email : null;
    },
    async listAccessibleCustomers(): Promise<string[]> {
      const response = await request<{ resourceNames?: string[] }>(
        `${GOOGLE_ADS_API_BASE}/customers:listAccessibleCustomers`,
      );
      return (response.resourceNames ?? []).map(cleanCustomerId);
    },
    async listCustomers(): Promise<GoogleAdsCustomer[]> {
      const roots = await this.listAccessibleCustomers();
      const customers = new Map<string, GoogleAdsCustomer>();
      const queue = roots.map((customerId) => ({
        customerId,
        loginCustomerId: null as string | null,
        rootCustomerId: customerId,
      }));
      const visitedManagers = new Set<string>();
      while (queue.length > 0 && visitedManagers.size < 100) {
        const next = queue.shift();
        if (!next || visitedManagers.has(next.customerId)) continue;
        visitedManagers.add(next.customerId);
        const direct = await listDirectCustomers(
          next.customerId,
          next.loginCustomerId,
        );
        for (const customer of direct) {
          customers.set(customer.customerId, {
            ...customer,
            loginCustomerId:
              customer.customerId === next.rootCustomerId
                ? null
                : next.rootCustomerId,
          });
          if (customer.manager && customer.customerId !== next.customerId) {
            queue.push({
              customerId: customer.customerId,
              loginCustomerId: next.rootCustomerId,
              rootCustomerId: next.rootCustomerId,
            });
          }
        }
      }
      return [...customers.values()].toSorted((a, b) =>
        a.descriptiveName.localeCompare(b.descriptiveName),
      );
    },
  };
}
