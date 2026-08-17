import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  reportDeliveryProfileSections,
  reportDeliveryProfiles,
  reportRecipients,
} from "@/db/schema";
import { runBatch } from "@/db/runBatch";
import type { ReportDeliveryFrequency } from "@/types/schemas/report-delivery";
import type { ReportSectionKey } from "@/types/schemas/reports";

export type ProfileWritableFields = {
  name: string;
  frequency: ReportDeliveryFrequency;
  timeZone: string;
  runDay: number | null;
  runWeekday: number | null;
  runHour: number;
  isEnabled: boolean;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  attachPdf: boolean;
  includeShareLink: boolean;
  shareLinkTtlDays: number;
  nextRunAt: string | null;
};

type SectionInput = { key: ReportSectionKey; enabled: boolean };
type RecipientInput = { email: string; name: string | null };

function sectionRows(profileId: string, sections: SectionInput[]) {
  return sections.map((section, sortOrder) => ({
    id: crypto.randomUUID(),
    profileId,
    sectionKey: section.key,
    sortOrder,
    isEnabled: section.enabled,
  }));
}

function recipientRows(profileId: string, recipients: RecipientInput[]) {
  return recipients.map((recipient) => ({
    id: crypto.randomUUID(),
    profileId,
    email: recipient.email,
    name: recipient.name,
  }));
}

async function listProfiles(projectId: string) {
  const rows = await db
    .select()
    .from(reportDeliveryProfiles)
    .where(eq(reportDeliveryProfiles.projectId, projectId))
    .orderBy(asc(reportDeliveryProfiles.name));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [sections, recipients] = await Promise.all([
    db
      .select()
      .from(reportDeliveryProfileSections)
      .where(inArray(reportDeliveryProfileSections.profileId, ids))
      .orderBy(asc(reportDeliveryProfileSections.sortOrder)),
    db
      .select()
      .from(reportRecipients)
      .where(inArray(reportRecipients.profileId, ids))
      .orderBy(asc(reportRecipients.email)),
  ]);
  return rows.map((profile) => ({
    profile,
    sections: sections.filter((section) => section.profileId === profile.id),
    recipients: recipients.filter(
      (recipient) => recipient.profileId === profile.id,
    ),
  }));
}

async function getProfile(projectId: string, profileId: string) {
  const rows = await db
    .select()
    .from(reportDeliveryProfiles)
    .where(
      and(
        eq(reportDeliveryProfiles.id, profileId),
        eq(reportDeliveryProfiles.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getProfileById(profileId: string) {
  const rows = await db
    .select()
    .from(reportDeliveryProfiles)
    .where(eq(reportDeliveryProfiles.id, profileId))
    .limit(1);
  return rows[0] ?? null;
}

async function getProfileSections(profileId: string) {
  return db
    .select()
    .from(reportDeliveryProfileSections)
    .where(eq(reportDeliveryProfileSections.profileId, profileId))
    .orderBy(asc(reportDeliveryProfileSections.sortOrder));
}

async function getProfileRecipients(profileId: string) {
  return db
    .select()
    .from(reportRecipients)
    .where(eq(reportRecipients.profileId, profileId))
    .orderBy(asc(reportRecipients.email));
}

async function createProfile(input: {
  id: string;
  projectId: string;
  organizationId: string;
  createdByUserId: string | null;
  fields: ProfileWritableFields;
  sections: SectionInput[];
  recipients: RecipientInput[];
}) {
  await runBatch((tx) => [
    tx.insert(reportDeliveryProfiles).values({
      id: input.id,
      projectId: input.projectId,
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId,
      ...input.fields,
    }),
    ...sectionRows(input.id, input.sections).map((row) =>
      tx.insert(reportDeliveryProfileSections).values(row),
    ),
    ...recipientRows(input.id, input.recipients).map((row) =>
      tx.insert(reportRecipients).values(row),
    ),
  ]);
}

async function updateProfile(input: {
  profileId: string;
  fields: ProfileWritableFields;
  sections: SectionInput[];
  recipients: RecipientInput[];
}) {
  await runBatch((tx) => [
    tx
      .update(reportDeliveryProfiles)
      .set({ ...input.fields, updatedAt: new Date().toISOString() })
      .where(eq(reportDeliveryProfiles.id, input.profileId)),
    tx
      .delete(reportDeliveryProfileSections)
      .where(eq(reportDeliveryProfileSections.profileId, input.profileId)),
    tx
      .delete(reportRecipients)
      .where(eq(reportRecipients.profileId, input.profileId)),
    ...sectionRows(input.profileId, input.sections).map((row) =>
      tx.insert(reportDeliveryProfileSections).values(row),
    ),
    ...recipientRows(input.profileId, input.recipients).map((row) =>
      tx.insert(reportRecipients).values(row),
    ),
  ]);
}

async function deleteProfile(projectId: string, profileId: string) {
  const rows = await db
    .delete(reportDeliveryProfiles)
    .where(
      and(
        eq(reportDeliveryProfiles.id, profileId),
        eq(reportDeliveryProfiles.projectId, projectId),
      ),
    )
    .returning({ id: reportDeliveryProfiles.id });
  return Boolean(rows[0]);
}

async function listDueProfiles(nowIso: string) {
  return db
    .select({
      profile: reportDeliveryProfiles,
      organizationId: projects.organizationId,
    })
    .from(reportDeliveryProfiles)
    .innerJoin(projects, eq(reportDeliveryProfiles.projectId, projects.id))
    .where(
      and(
        eq(reportDeliveryProfiles.isEnabled, true),
        lte(reportDeliveryProfiles.nextRunAt, nowIso),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(reportDeliveryProfiles.nextRunAt))
    .limit(100);
}

/** Compare-and-set on nextRunAt: two concurrent cron ticks cannot both claim
 * the same scheduled instant. */
async function claimProfile(input: {
  profileId: string;
  observedNextRunAt: string;
  nextRunAt: string;
}) {
  const rows = await db
    .update(reportDeliveryProfiles)
    .set({
      nextRunAt: input.nextRunAt,
      lastRunAt: input.observedNextRunAt,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(reportDeliveryProfiles.id, input.profileId),
        eq(reportDeliveryProfiles.isEnabled, true),
        eq(reportDeliveryProfiles.nextRunAt, input.observedNextRunAt),
      ),
    )
    .returning({ id: reportDeliveryProfiles.id });
  return Boolean(rows[0]);
}

export const ReportDeliveryProfileRepository = {
  listProfiles,
  getProfile,
  getProfileById,
  getProfileSections,
  getProfileRecipients,
  createProfile,
  updateProfile,
  deleteProfile,
  listDueProfiles,
  claimProfile,
};
