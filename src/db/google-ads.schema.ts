import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

// One Google Ads serving account per project. OAuth tokens stay in Better
// Auth's account table under the dedicated google-ads provider.
export const googleAdsConnections = sqliteTable(
  "google_ads_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    customerId: text("customer_id").notNull(),
    customerName: text("customer_name").notNull(),
    currencyCode: text("currency_code").notNull(),
    timeZone: text("time_zone").notNull(),
    loginCustomerId: text("login_customer_id"),
    connectedByUserId: text("connected_by_user_id").notNull(),
    googleAdsAccountId: text("google_ads_account_id").notNull(),
    connectedAccountEmail: text("connected_account_email"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("google_ads_connections_project_idx").on(table.projectId),
    index("google_ads_connections_organization_idx").on(table.organizationId),
    index("google_ads_connections_connector_idx").on(
      table.connectedByUserId,
      table.googleAdsAccountId,
    ),
  ],
);
