import { normalizeBacklinksTarget } from "@/server/lib/dataforseoBacklinksTarget";
import { AppError } from "@/server/lib/errors";
import { DisavowRepository } from "@/server/features/backlinks/repositories/DisavowRepository";
import { ToxicityAuditRepository } from "@/server/features/backlinks/repositories/ToxicityAuditRepository";
import {
  buildGoogleDisavowTxt,
  normalizeDisavowValue,
} from "@/server/features/backlinks/services/DisavowService";
import {
  collectBacklinkSignals,
  collectReferringDomains,
  scoreAccumulatedDomains,
  type BacklinksAuditClient,
} from "@/server/features/backlinks/services/toxicityAuditCollect";
import {
  isExportableDisavowStatus,
  isWhitelistedDisavowStatus,
  scoreProfileToxicity,
  selectExportableAuditRows,
} from "@/shared/backlink-toxicity";
import type { DisavowStatus } from "@/types/schemas/disavow";
import {
  allToRows,
  countLive,
  parseMarkers,
  sumBacklinkDelta,
  toView,
  type ToxicityAuditView,
} from "@/server/features/backlinks/services/toxicityAuditView";

export type {
  ToxicityAuditView,
  ToxicityDomainView,
} from "@/server/features/backlinks/services/toxicityAuditView";

const AUDIT_COMMENTS = "Toxicity audit";

type BillingCustomer = {
  organizationId: string;
  userId: string;
  userEmail: string;
  projectId?: string;
};

type ToxicityAuditDeps = {
  createClient: (customer: BillingCustomer) => BacklinksAuditClient;
  audits?: typeof ToxicityAuditRepository;
  disavow?: typeof DisavowRepository;
};

function createToxicityAuditService(deps: ToxicityAuditDeps) {
  const createClient = deps.createClient;
  const audits = deps.audits ?? ToxicityAuditRepository;
  const disavow = deps.disavow ?? DisavowRepository;

  return {
    async getLatest(projectId: string): Promise<ToxicityAuditView | null> {
      const latest = await audits.getLatest(projectId);
      if (!latest) return null;
      return toView(
        latest.audit,
        latest.domains,
        await statusByDomain(disavow, projectId),
      );
    },

    async runAudit(input: {
      projectId: string;
      target: string;
      scope?: "domain" | "page";
      languageCode?: string;
      billingCustomer: BillingCustomer;
    }): Promise<ToxicityAuditView> {
      const normalized = normalizeBacklinksTarget(input.target, {
        scope: input.scope,
      });
      const client = createClient(input.billingCustomer);
      const now = new Date();
      const previous = await audits.getLatest(input.projectId);
      const statuses = await statusByDomain(disavow, input.projectId);
      const { domains: referring, truncated: truncatedDomains } =
        await collectReferringDomains(client, normalized.apiTarget);
      const { byDomain, truncated: truncatedBacklinks } =
        await collectBacklinkSignals({
          client,
          target: normalized.apiTarget,
          referring,
          targetLanguage: input.languageCode ?? "en",
          targetHost: normalized.apiTarget,
          now,
        });
      const scored = scoreAccumulatedDomains(byDomain);
      const previousByDomain = new Map(
        (previous?.domains ?? []).map((row) => [row.domain, row]),
      );
      const currentNames = new Set(scored.map((row) => row.domain));
      const lost = (previous?.domains ?? [])
        .filter((row) => !currentNames.has(row.domain))
        .map((row) => ({
          domain: row.domain,
          score: row.score,
          verdict: row.verdict,
          classification: row.classification,
          backlinkCount: 0,
          brokenBacklinkCount: 0,
          rank: row.rank,
          spamScore: row.spamScore,
          isNew: false,
          isLost: true,
          isBroken: row.isBroken,
          markers: parseMarkers(row.markersJson),
        }));
      const live = scored.map((row) => ({
        ...row,
        isNew: !previousByDomain.has(row.domain),
        isLost: false,
        isBroken: row.brokenBacklinkCount > 0,
      }));
      const all = [...live, ...lost];
      const counts = countLive(live);
      const profile = scoreProfileToxicity({
        domainScores: live.map((row) => row.score),
        toxicDomainCount: counts.toxicCount,
        potentiallyToxicDomainCount: counts.potentiallyToxicCount,
        domainCount: counts.domainCount,
      });
      const nowIso = now.toISOString();
      const auditId = crypto.randomUUID();
      const audit = await audits.insertAudit({
        id: auditId,
        projectId: input.projectId,
        target: normalized.apiTarget,
        scope: normalized.scope,
        profileScore: profile.score,
        profileVerdict: profile.verdict,
        ...counts,
        newDomainCount: live.filter((row) => row.isNew).length,
        lostDomainCount: lost.length,
        brokenDomainCount: live.filter((row) => row.isBroken).length,
        newBacklinkCount: sumBacklinkDelta(live, previousByDomain, 1),
        lostBacklinkCount:
          sumBacklinkDelta(live, previousByDomain, -1) +
          lost.reduce(
            (sum, row) =>
              sum + (previousByDomain.get(row.domain)?.backlinkCount ?? 0),
            0,
          ),
        brokenBacklinkCount: live.reduce(
          (sum, row) => sum + row.brokenBacklinkCount,
          0,
        ),
        truncated: truncatedDomains || truncatedBacklinks,
        createdAt: nowIso,
      });
      if (!audit) {
        throw new AppError("INTERNAL_ERROR", "Could not save toxicity audit.");
      }
      await audits.insertDomains(
        all.map((row) => ({
          id: crypto.randomUUID(),
          auditId,
          projectId: input.projectId,
          domain: row.domain,
          score: row.score,
          verdict: row.verdict,
          classification: row.classification,
          backlinkCount: row.backlinkCount,
          brokenBacklinkCount: row.brokenBacklinkCount,
          rank: row.rank,
          spamScore: row.spamScore,
          isNew: row.isNew,
          isLost: row.isLost,
          isBroken: row.isBroken,
          markersJson: JSON.stringify(row.markers),
          createdAt: nowIso,
        })),
      );
      await audits.pruneOlderThan(input.projectId);
      return toView(
        audit,
        allToRows(auditId, input.projectId, nowIso, all),
        statuses,
      );
    },

    async whitelistDomain(projectId: string, domain: string) {
      await disavow.saveManual({
        projectId,
        entryType: "domain",
        value: normalizeDisavowValue("domain", domain),
        status: "kept",
        comments: "Whitelist — do not disavow",
        linkCount: 0,
        exportedAt: null,
      });
      return this.getLatest(projectId);
    },

    async moveToDisavow(projectId: string, domain: string) {
      const value = normalizeDisavowValue("domain", domain);
      const existing = await disavow.getByValue(projectId, "domain", value);
      if (isWhitelistedDisavowStatus(existing?.status)) {
        throw new AppError(
          "VALIDATION_ERROR",
          "Whitelisted domains cannot be moved to disavow.",
        );
      }
      const latest = await audits.getLatest(projectId);
      const scored = latest?.domains.find((row) => row.domain === value);
      if (scored && scored.classification === "non_toxic") {
        throw new AppError(
          "VALIDATION_ERROR",
          "Non-toxic domains cannot be moved to disavow from the audit.",
        );
      }
      await disavow.saveManual({
        id: existing?.id,
        projectId,
        entryType: "domain",
        value,
        status: "disavowed",
        comments: existing?.comments ?? AUDIT_COMMENTS,
        linkCount: scored?.backlinkCount ?? existing?.linkCount ?? 0,
        exportedAt: null,
      });
      return this.getLatest(projectId);
    },

    async removeFromDisavow(projectId: string, domain: string) {
      const value = normalizeDisavowValue("domain", domain);
      const existing = await disavow.getByValue(projectId, "domain", value);
      if (
        !existing ||
        !isExportableDisavowStatus(existing.status) ||
        isWhitelistedDisavowStatus(existing.status)
      ) {
        return this.getLatest(projectId);
      }
      await disavow.saveManual({
        id: existing.id,
        projectId,
        entryType: "domain",
        value,
        status: "pending",
        comments: existing.comments,
        linkCount: existing.linkCount,
        exportedAt: null,
      });
      return this.getLatest(projectId);
    },

    async previewExport(projectId: string) {
      const latest = await this.getLatest(projectId);
      const exportable = selectExportableAuditRows(
        (latest?.domains ?? []).map((row) => ({
          domain: row.domain,
          classification: row.classification,
          status: row.status,
          comments: AUDIT_COMMENTS,
          linkCount: row.backlinkCount,
        })),
      );
      return {
        content: buildGoogleDisavowTxt(
          exportable.map((row) => ({
            entryType: "domain" as const,
            value: row.domain,
            comments: row.comments,
            linkCount: row.linkCount,
          })),
        ),
        domains: exportable.map((row) => row.domain),
      };
    },
  } as const;
}

async function statusByDomain(
  disavow: typeof DisavowRepository,
  projectId: string,
) {
  const entries = await disavow.list(projectId);
  const map = new Map<string, DisavowStatus>();
  for (const entry of entries) {
    if (entry.entryType === "domain") map.set(entry.value, entry.status);
  }
  return map;
}

export { createToxicityAuditService };
