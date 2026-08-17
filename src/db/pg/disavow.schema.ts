import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const backlinkDisavowEntries = pgTable(
  "backlink_disavow_entries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entryType: text("entry_type", { enum: ["domain", "url"] }).notNull(),
    value: text("value").notNull(),
    status: text("status", {
      enum: ["pending", "kept", "removal_requested", "disavowed", "exported"],
    })
      .notNull()
      .default("pending"),
    comments: text("comments"),
    source: text("source", {
      enum: ["manual", "semrush_csv", "google_txt"],
    })
      .notNull()
      .default("manual"),
    linkCount: integer("link_count").notNull().default(0),
    exportedAt: text("exported_at"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("backlink_disavow_entries_project_type_value_idx").on(
      table.projectId,
      table.entryType,
      table.value,
    ),
    index("backlink_disavow_entries_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);
