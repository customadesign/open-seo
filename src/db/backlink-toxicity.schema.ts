import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { projects } from "./app.schema";
import {
  TOXICITY_CLASSIFICATIONS,
  TOXICITY_VERDICTS,
} from "@/shared/backlink-toxicity";

export const backlinkToxicityAudits = sqliteTable(
  "backlink_toxicity_audits",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    target: text("target").notNull(),
    scope: text("scope", { enum: ["domain", "page"] }).notNull(),
    profileScore: integer("profile_score").notNull(),
    profileVerdict: text("profile_verdict", {
      enum: TOXICITY_VERDICTS,
    }).notNull(),
    domainCount: integer("domain_count").notNull().default(0),
    backlinkCount: integer("backlink_count").notNull().default(0),
    toxicCount: integer("toxic_count").notNull().default(0),
    potentiallyToxicCount: integer("potentially_toxic_count")
      .notNull()
      .default(0),
    nonToxicCount: integer("non_toxic_count").notNull().default(0),
    toxicPercent: integer("toxic_percent").notNull().default(0),
    newDomainCount: integer("new_domain_count").notNull().default(0),
    lostDomainCount: integer("lost_domain_count").notNull().default(0),
    brokenDomainCount: integer("broken_domain_count").notNull().default(0),
    newBacklinkCount: integer("new_backlink_count").notNull().default(0),
    lostBacklinkCount: integer("lost_backlink_count").notNull().default(0),
    brokenBacklinkCount: integer("broken_backlink_count").notNull().default(0),
    truncated: integer("truncated", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("backlink_toxicity_audits_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const backlinkToxicityDomains = sqliteTable(
  "backlink_toxicity_domains",
  {
    id: text("id").primaryKey(),
    auditId: text("audit_id")
      .notNull()
      .references(() => backlinkToxicityAudits.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    score: integer("score").notNull(),
    verdict: text("verdict", { enum: TOXICITY_VERDICTS }).notNull(),
    classification: text("classification", {
      enum: TOXICITY_CLASSIFICATIONS,
    }).notNull(),
    backlinkCount: integer("backlink_count").notNull().default(0),
    brokenBacklinkCount: integer("broken_backlink_count").notNull().default(0),
    rank: integer("rank"),
    spamScore: integer("spam_score"),
    isNew: integer("is_new", { mode: "boolean" }).notNull().default(false),
    isLost: integer("is_lost", { mode: "boolean" }).notNull().default(false),
    isBroken: integer("is_broken", { mode: "boolean" })
      .notNull()
      .default(false),
    markersJson: text("markers_json").notNull().default("[]"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("backlink_toxicity_domains_audit_domain_idx").on(
      table.auditId,
      table.domain,
    ),
    index("backlink_toxicity_domains_project_class_idx").on(
      table.projectId,
      table.classification,
    ),
  ],
);
