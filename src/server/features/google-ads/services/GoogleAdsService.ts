import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { account } from "@/db/schema";
import { GoogleAdsConnectionRepository } from "@/server/features/google-ads/repositories/GoogleAdsConnectionRepository";
import { AppError } from "@/server/lib/errors";
import { createGoogleAdsClient } from "@/server/lib/googleAdsClient";
import {
  GoogleAdsApiError,
  GoogleAdsTokenError,
} from "@/server/lib/googleAdsErrors";
import { GOOGLE_ADS_OAUTH_PROVIDER_ID } from "@/shared/google-ads";

function objectValue(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).safeParse(value).data ?? {};
}

function numericValue(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : "";
}

function summaryQuery(start: string, end: string) {
  return `SELECT customer.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${start}' AND '${end}'`;
}

function metricValues(row: Record<string, unknown>) {
  const metrics = objectValue(row.metrics);
  const cost = numericValue(metrics.costMicros) / 1_000_000;
  const clicks = numericValue(metrics.clicks);
  const impressions = numericValue(metrics.impressions);
  const conversions = numericValue(metrics.conversions);
  const conversionValue = numericValue(metrics.conversionsValue);
  return {
    cost,
    impressions,
    clicks,
    ctr: numericValue(metrics.ctr),
    averageCpc: numericValue(metrics.averageCpc) / 1_000_000,
    conversions,
    costPerConversion: conversions > 0 ? cost / conversions : null,
    conversionValue,
    roas: cost > 0 ? conversionValue / cost : null,
  };
}

function comparison(current: number | null, previous: number | null) {
  const change =
    current != null && previous != null ? current - previous : null;
  return {
    current,
    previous,
    change,
    percentChange:
      change != null && previous != null && previous !== 0
        ? change / previous
        : null,
  };
}

async function listGrantsForUser(userId: string) {
  return db
    .select({ id: account.id, accountId: account.accountId })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, GOOGLE_ADS_OAUTH_PROVIDER_ID),
      ),
    );
}

function requiresReconnect(error: unknown): boolean {
  return (
    error instanceof GoogleAdsTokenError ||
    (error instanceof GoogleAdsApiError && error.status === 401)
  );
}

async function listCustomersForUser(userId: string) {
  const grants = await listGrantsForUser(userId);
  const accounts = await Promise.all(
    grants.map(async (grant) => {
      const client = createGoogleAdsClient({
        userId,
        googleAdsAccountId: grant.accountId,
      });
      try {
        const [customers, email] = await Promise.all([
          client.listCustomers(),
          client.getUserInfoEmail().catch(() => null),
        ]);
        return {
          accountId: grant.accountId,
          email,
          requiresReconnect: false,
          customersUnavailable: false,
          customers,
        };
      } catch (error) {
        const reconnect = requiresReconnect(error);
        if (!reconnect)
          console.error("google_ads.customer_discovery_failed", error);
        return {
          accountId: grant.accountId,
          email: null,
          requiresReconnect: reconnect,
          customersUnavailable: !reconnect,
          customers: [],
        };
      }
    }),
  );
  return { accounts };
}

async function setCustomer(input: {
  projectId: string;
  organizationId: string;
  userId: string;
  accountId: string;
  customerId: string;
}) {
  const grants = await listGrantsForUser(input.userId);
  if (!grants.some((grant) => grant.accountId === input.accountId)) {
    throw new AppError("NOT_FOUND", "That Google account is not connected.");
  }
  const client = createGoogleAdsClient({
    userId: input.userId,
    googleAdsAccountId: input.accountId,
  });
  const customer = (await client.listCustomers()).find(
    (entry) => entry.customerId === input.customerId.replaceAll("-", ""),
  );
  if (!customer || customer.manager) {
    throw new AppError(
      "NOT_FOUND",
      "That Google Ads serving account is not available.",
    );
  }
  return GoogleAdsConnectionRepository.upsert({
    projectId: input.projectId,
    organizationId: input.organizationId,
    customerId: customer.customerId,
    customerName: customer.descriptiveName,
    currencyCode: customer.currencyCode,
    timeZone: customer.timeZone,
    loginCustomerId: customer.loginCustomerId,
    connectedByUserId: input.userId,
    googleAdsAccountId: input.accountId,
    connectedAccountEmail: await client.getUserInfoEmail().catch(() => null),
  });
}

async function disconnect(input: { projectId: string; userId: string }) {
  const connection = await GoogleAdsConnectionRepository.getByProjectId(
    input.projectId,
  );
  await GoogleAdsConnectionRepository.deleteByProjectId(input.projectId);
  if (connection?.connectedByUserId !== input.userId) return;
  const stillUsed =
    await GoogleAdsConnectionRepository.existsForConnectorAccount(
      input.userId,
      connection.googleAdsAccountId,
    );
  if (stillUsed) return;
  await db
    .delete(account)
    .where(
      and(
        eq(account.userId, input.userId),
        eq(account.providerId, GOOGLE_ADS_OAUTH_PROVIDER_ID),
        eq(account.accountId, connection.googleAdsAccountId),
      ),
    );
}

async function getPerformanceReport(input: {
  projectId: string;
  periodStart: string;
  periodEnd: string;
  compareStart: string;
  compareEnd: string;
}) {
  const connection = await GoogleAdsConnectionRepository.getByProjectId(
    input.projectId,
  );
  if (!connection) return null;
  const client = createGoogleAdsClient({
    userId: connection.connectedByUserId,
    googleAdsAccountId: connection.googleAdsAccountId,
  });
  const [currentRows, previousRows, trendRows, campaignRows] =
    await Promise.all([
      client.search(
        connection.customerId,
        summaryQuery(input.periodStart, input.periodEnd),
        connection.loginCustomerId,
      ),
      client.search(
        connection.customerId,
        summaryQuery(input.compareStart, input.compareEnd),
        connection.loginCustomerId,
      ),
      client.search(
        connection.customerId,
        `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${input.periodStart}' AND '${input.periodEnd}' ORDER BY segments.date`,
        connection.loginCustomerId,
      ),
      client.search(
        connection.customerId,
        `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${input.periodStart}' AND '${input.periodEnd}' AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 20`,
        connection.loginCustomerId,
      ),
    ]);
  const current = metricValues(currentRows[0] ?? {});
  const previous = metricValues(previousRows[0] ?? {});
  const metrics = {
    cost: comparison(current.cost, previous.cost),
    impressions: comparison(current.impressions, previous.impressions),
    clicks: comparison(current.clicks, previous.clicks),
    ctr: comparison(current.ctr, previous.ctr),
    averageCpc: comparison(current.averageCpc, previous.averageCpc),
    conversions: comparison(current.conversions, previous.conversions),
    costPerConversion: comparison(
      current.costPerConversion,
      previous.costPerConversion,
    ),
    conversionValue: comparison(
      current.conversionValue,
      previous.conversionValue,
    ),
    roas: comparison(current.roas, previous.roas),
  };
  return {
    customerId: connection.customerId,
    customerName: connection.customerName,
    currencyCode: connection.currencyCode,
    metrics,
    trend: trendRows.map((row) => {
      const values = metricValues(row);
      return {
        date: textValue(objectValue(row.segments).date),
        cost: values.cost,
        clicks: values.clicks,
        impressions: values.impressions,
        conversions: values.conversions,
        conversionValue: values.conversionValue,
      };
    }),
    campaigns: campaignRows.map((row) => {
      const campaign = objectValue(row.campaign);
      const values = metricValues(row);
      return {
        id: textValue(campaign.id),
        name: textValue(campaign.name),
        status: textValue(campaign.status),
        cost: values.cost,
        clicks: values.clicks,
        impressions: values.impressions,
        ctr: values.ctr,
        conversions: values.conversions,
        costPerConversion: values.costPerConversion,
        conversionValue: values.conversionValue,
      };
    }),
  };
}

export const GoogleAdsService = {
  getConnection: GoogleAdsConnectionRepository.getByProjectId,
  async userHasGrant(userId: string) {
    return (await listGrantsForUser(userId)).length > 0;
  },
  listCustomersForUser,
  setCustomer,
  disconnect,
  getPerformanceReport,
};
