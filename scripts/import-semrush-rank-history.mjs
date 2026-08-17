#!/usr/bin/env node

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const databasePath = path.resolve(requiredArg(args, "database"));
const archiveDir = path.resolve(requiredArg(args, "archive"));
const mappingPath = path.resolve(requiredArg(args, "mapping"));
const auditPath = args.get("audit") ? path.resolve(args.get("audit")) : null;
const apply = args.has("apply");

const manifest = JSON.parse(
  await readFile(path.join(archiveDir, "manifest.json"), "utf8"),
);
const mapping = JSON.parse(await readFile(mappingPath, "utf8"));
if (manifest.campaignCount !== 35 || manifest.keywordEntries !== 1832) {
  throw new Error(
    `Archive reconciliation failed: campaigns=${manifest.campaignCount}, keywords=${manifest.keywordEntries}`,
  );
}

await verifyArchive(archiveDir, manifest);
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 10000");
assertSchema(db);

const audit = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  applied: apply,
  databasePath,
  archiveDir,
  mappingPath,
  trackerTargets: [],
  sources: [],
  totals: {
    campaigns: 0,
    sourceKeywords: 0,
    sourcesInserted: 0,
    runsInserted: 0,
    snapshotsInserted: 0,
  },
};

db.exec(apply ? "BEGIN IMMEDIATE" : "BEGIN");
try {
  applyTrackerTargets(db, mapping, audit);
  for (const entry of manifest.campaigns) {
    const payload = JSON.parse(
      await readFile(path.join(archiveDir, entry.filename), "utf8"),
    );
    importCampaign(db, payload, mapping, audit);
  }
  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  if (integrity !== "ok")
    throw new Error(`SQLite integrity check: ${integrity}`);
  const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyErrors.length > 0) {
    throw new Error(
      `Foreign-key check failed: ${JSON.stringify(foreignKeyErrors)}`,
    );
  }
  audit.integrityCheck = integrity;
  audit.foreignKeyErrors = foreignKeyErrors.length;
  audit.completedAt = new Date().toISOString();
  if (apply) db.exec("COMMIT");
  else db.exec("ROLLBACK");
} catch (error) {
  try {
    db.exec("ROLLBACK");
  } catch {
    // Transaction may already be closed.
  }
  throw error;
} finally {
  db.close();
}

if (auditPath) {
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, {
    mode: 0o600,
  });
}
process.stdout.write(`${JSON.stringify(audit.totals)}\n`);

function applyTrackerTargets(database, plan, result) {
  const archivedDomains = new Set(
    (plan.archiveDomains ?? []).map(normalizeDomain),
  );
  for (const domain of archivedDomains) {
    const changed = database
      .prepare(
        `UPDATE rank_tracking_configs
         SET is_active = 0, next_check_at = NULL
         WHERE lower(domain) = ? AND is_active = 1`,
      )
      .run(domain).changes;
    result.trackerTargets.push({ domain, archived: true, changed });
  }

  for (const [rawDomain, targetPlan] of Object.entries(plan.targets ?? {})) {
    const domain = normalizeDomain(rawDomain);
    const project = database
      .prepare("SELECT id, name FROM projects WHERE lower(domain) = ?")
      .get(domain);
    if (!project) throw new Error(`OpenSEO project not found for ${domain}`);
    const existingConfigs = database
      .prepare(
        `SELECT c.*,
          (SELECT count(*) FROM rank_tracking_keywords k WHERE k.config_id = c.id) AS keyword_count
         FROM rank_tracking_configs c
         WHERE c.project_id = ? AND lower(c.domain) = ?
         ORDER BY c.created_at, c.id`,
      )
      .all(project.id, domain);
    if (existingConfigs.length === 0) {
      throw new Error(`No rank tracker exists for ${domain}`);
    }
    const sourceKeywords = collectKeywords(database, existingConfigs);
    const claimedConfigIds = new Set();
    const targetConfigs = [];

    for (const [targetIndex, target] of targetPlan.entries()) {
      const finalName = target.locationName ?? null;
      let config = existingConfigs.find(
        (row) =>
          !claimedConfigIds.has(row.id) &&
          row.location_code === target.locationCode &&
          (row.location_name ?? null) === finalName,
      );
      if (!config && target.existingLocationCode != null) {
        config = existingConfigs.find(
          (row) =>
            !claimedConfigIds.has(row.id) &&
            row.location_code === target.existingLocationCode,
        );
      }
      if (!config && targetIndex === 0) {
        config = existingConfigs
          .filter((row) => !claimedConfigIds.has(row.id))
          .toSorted(
            (a, b) => Number(b.keyword_count) - Number(a.keyword_count),
          )[0];
      }
      if (!config) {
        const template = targetConfigs[0] ?? existingConfigs[0];
        const id = deterministicUuid(
          `openseo-target:${project.id}:${domain}:${finalName}`,
        );
        database
          .prepare(
            `INSERT OR IGNORE INTO rank_tracking_configs
              (id, project_id, domain, location_code, language_code, devices,
               serp_depth, schedule_interval, location_name, is_active,
               last_checked_at, next_check_at, last_skip_reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, ?)`,
          )
          .run(
            id,
            project.id,
            domain,
            target.locationCode,
            target.languageCode ?? template.language_code,
            target.devices ?? template.devices,
            target.serpDepth ?? template.serp_depth,
            target.scheduleInterval ?? template.schedule_interval,
            finalName,
            new Date().toISOString(),
          );
        config = database
          .prepare("SELECT * FROM rank_tracking_configs WHERE id = ?")
          .get(id);
      }
      database
        .prepare(
          `UPDATE rank_tracking_configs
           SET location_code = ?, location_name = ?, language_code = ?,
               devices = ?, serp_depth = ?, schedule_interval = ?, is_active = 1,
               next_check_at = CASE WHEN ? = 'manual' THEN NULL ELSE next_check_at END
           WHERE id = ?`,
        )
        .run(
          target.locationCode,
          finalName,
          target.languageCode ?? config.language_code,
          target.devices ?? config.devices,
          target.serpDepth ?? config.serp_depth,
          target.scheduleInterval ?? config.schedule_interval,
          target.scheduleInterval ?? config.schedule_interval,
          config.id,
        );
      claimedConfigIds.add(config.id);
      const refreshed = database
        .prepare("SELECT * FROM rank_tracking_configs WHERE id = ?")
        .get(config.id);
      const targetKeywords = target.preserveExistingKeywords
        ? collectKeywords(database, [config])
        : sourceKeywords;
      upsertKeywords(database, refreshed.id, targetKeywords);
      targetConfigs.push(refreshed);
    }

    for (const config of existingConfigs) {
      if (claimedConfigIds.has(config.id)) continue;
      database
        .prepare(
          `UPDATE rank_tracking_configs
           SET is_active = 0, next_check_at = NULL
           WHERE id = ?`,
        )
        .run(config.id);
    }
    result.trackerTargets.push({
      projectId: project.id,
      domain,
      sourceConfigCount: existingConfigs.length,
      keywordCount: sourceKeywords.length,
      targets: targetConfigs.map((config) => ({
        configId: config.id,
        locationCode: config.location_code,
        locationName: config.location_name,
      })),
    });
  }
}

function importCampaign(database, payload, plan, result) {
  const campaign = payload.campaign;
  const domain = normalizeDomain(campaign.projectUrl);
  const project = database
    .prepare("SELECT id FROM projects WHERE lower(domain) = ?")
    .get(domain);
  if (!project) throw new Error(`Campaign project not found: ${domain}`);
  const allConfigs = database
    .prepare(
      `SELECT * FROM rank_tracking_configs
       WHERE project_id = ?
       ORDER BY is_active DESC, created_at, id`,
    )
    .all(project.id);
  const activeConfigs = allConfigs.filter((config) => config.is_active === 1);
  const configs = activeConfigs.length > 0 ? activeConfigs : allConfigs;
  if (configs.length === 0) {
    throw new Error(`No active target config for campaign ${campaign.id}`);
  }

  const sourceLocationName = canonicalLocation(campaign.location?.name ?? "");
  const sourceTargetName =
    String(campaign.location?.type ?? "").toLowerCase() === "country"
      ? null
      : sourceLocationName;
  const sourceCountryCode = countryLocationCode(campaign.location?.code);
  const sourceDevice = campaign.device === "phone" ? "mobile" : "desktop";
  const sourceLanguage = campaign.location?.hl ?? "en";
  const exactConfig = configs.find(
    (config) =>
      config.location_code === sourceCountryCode &&
      (config.location_name ?? null) === sourceTargetName,
  );
  const preferredTarget = plan.targets?.[domain]?.find(
    (target) => target.historyPrimary,
  );
  const primaryConfig = preferredTarget
    ? configs.find(
        (config) =>
          config.location_code === preferredTarget.locationCode &&
          (config.location_name ?? null) ===
            (preferredTarget.locationName ?? null),
      )
    : configs[0];
  const config = exactConfig ?? primaryConfig ?? configs[0];
  const supportsDevice =
    config.devices === "both" || config.devices === sourceDevice;
  const continuity =
    campaign.engine === "google" &&
    Boolean(exactConfig) &&
    config.language_code === sourceLanguage &&
    supportsDevice
      ? "continuous"
      : "legacy";
  const dates = objectValues(payload.datesResponse?.data)
    .map((row) => String(row.Dt ?? ""))
    .filter(Boolean)
    .toSorted();
  const sourceId = deterministicUuid(`semrush-source:${campaign.id}`);
  const firstObservedAt = dates[0] ? historyTimestamp(dates[0]) : null;
  const lastObservedAt = dates.at(-1) ? historyTimestamp(dates.at(-1)) : null;
  const existingSource = database
    .prepare(
      `SELECT id FROM rank_history_sources
       WHERE provider = 'semrush' AND external_campaign_id = ?`,
    )
    .get(campaign.id);
  const effectiveSourceId = existingSource?.id ?? sourceId;
  database
    .prepare(
      `INSERT INTO rank_history_sources
        (id, project_id, config_id, provider, external_campaign_id,
         search_engine, source_location_code, source_location_name,
         source_location_type, language_code, device, continuity,
         first_observed_at, last_observed_at, imported_at)
       VALUES (?, ?, ?, 'semrush', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, external_campaign_id) DO UPDATE SET
         project_id = excluded.project_id,
         config_id = excluded.config_id,
         search_engine = excluded.search_engine,
         source_location_code = excluded.source_location_code,
         source_location_name = excluded.source_location_name,
         source_location_type = excluded.source_location_type,
         language_code = excluded.language_code,
         device = excluded.device,
         continuity = excluded.continuity,
         first_observed_at = excluded.first_observed_at,
         last_observed_at = excluded.last_observed_at`,
    )
    .run(
      effectiveSourceId,
      project.id,
      config.id,
      campaign.id,
      campaign.engine,
      Number(campaign.location?.id) || null,
      sourceLocationName || "Unknown",
      campaign.location?.type ?? null,
      sourceLanguage,
      sourceDevice,
      continuity,
      firstObservedAt,
      lastObservedAt,
      new Date().toISOString(),
    );

  const keywordRows = objectValues(payload.positionsResponse?.data);
  const trackingKeywords = new Map(
    database
      .prepare(
        `SELECT id, keyword FROM rank_tracking_keywords WHERE config_id = ?`,
      )
      .all(config.id)
      .map((row) => [normalizeKeyword(row.keyword), row]),
  );
  const snapshotsByDate = new Map(dates.map((date) => [date, []]));
  for (const row of keywordRows) {
    const keyword = String(row.Ph ?? "").trim();
    if (!keyword) continue;
    let tracked = trackingKeywords.get(normalizeKeyword(keyword));
    if (!tracked) {
      const id = deterministicUuid(
        `semrush-keyword:${config.id}:${normalizeKeyword(keyword)}`,
      );
      database
        .prepare(
          `INSERT OR IGNORE INTO rank_tracking_keywords
            (id, config_id, keyword, search_volume, keyword_difficulty, cpc,
             metrics_fetched_at, created_at)
           VALUES (?, ?, ?, ?, NULL, ?, NULL, ?)`,
        )
        .run(
          id,
          config.id,
          keyword,
          finiteNumber(row.Nq),
          finiteNumber(row.Cp),
          new Date().toISOString(),
        );
      tracked = { id, keyword };
      trackingKeywords.set(normalizeKeyword(keyword), tracked);
    }
    for (const [date, value] of Object.entries(row.Dt ?? {})) {
      if (!snapshotsByDate.has(date)) snapshotsByDate.set(date, []);
      snapshotsByDate.get(date).push({
        trackingKeywordId: tracked.id,
        keyword,
        position: normalizePosition(firstScalar(value)),
        url: stringOrNull(firstScalar(row.Lu?.[date] ?? row.Lu)),
        serpFeatures: JSON.stringify(arrayValues(row.Sf?.[date])),
      });
    }
  }

  let runsInserted = 0;
  let snapshotsInserted = 0;
  for (const [date, snapshots] of [...snapshotsByDate.entries()].toSorted()) {
    if (snapshots.length === 0) continue;
    const timestamp = historyTimestamp(date);
    const runId = deterministicUuid(`semrush-run:${campaign.id}:${date}`);
    const runResult = database
      .prepare(
        `INSERT OR IGNORE INTO rank_check_runs
          (id, config_id, project_id, status, keywords_total, keywords_checked,
           is_subset_run, history_source_id, target_location_code,
           target_location_name, target_language_code, target_serp_depth,
           error_message, started_at, completed_at)
         VALUES (?, ?, ?, 'completed', ?, ?, 0, ?, ?, ?, ?, 100, NULL, ?, ?)`,
      )
      .run(
        runId,
        config.id,
        project.id,
        snapshots.length,
        snapshots.length,
        effectiveSourceId,
        continuity === "continuous" ? config.location_code : sourceCountryCode,
        continuity === "continuous" ? config.location_name : sourceTargetName,
        sourceLanguage,
        timestamp,
        timestamp,
      );
    runsInserted += Number(runResult.changes);
    const insertSnapshot = database.prepare(
      `INSERT OR IGNORE INTO rank_snapshots
        (run_id, tracking_keyword_id, keyword, device, position, url,
         serp_features, checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const snapshot of snapshots) {
      const inserted = insertSnapshot.run(
        runId,
        snapshot.trackingKeywordId,
        snapshot.keyword,
        sourceDevice,
        snapshot.position,
        snapshot.url,
        snapshot.serpFeatures,
        timestamp,
      );
      snapshotsInserted += Number(inserted.changes);
    }
  }

  result.totals.campaigns += 1;
  result.totals.sourceKeywords += campaign.keywords?.length ?? 0;
  result.totals.sourcesInserted += existingSource ? 0 : 1;
  result.totals.runsInserted += runsInserted;
  result.totals.snapshotsInserted += snapshotsInserted;
  result.sources.push({
    campaignId: campaign.id,
    projectId: project.id,
    configId: config.id,
    domain,
    engine: campaign.engine,
    sourceLocationName,
    continuity,
    keywordCount: keywordRows.length,
    dateCount: dates.length,
    runsInserted,
    snapshotsInserted,
  });
}

function collectKeywords(database, configs) {
  const byKeyword = new Map();
  for (const config of configs) {
    const rows = database
      .prepare(
        `SELECT keyword, search_volume, keyword_difficulty, cpc,
                metrics_fetched_at, created_at
         FROM rank_tracking_keywords WHERE config_id = ?`,
      )
      .all(config.id);
    for (const row of rows) {
      const key = normalizeKeyword(row.keyword);
      const existing = byKeyword.get(key);
      if (!existing || scoreMetrics(row) > scoreMetrics(existing)) {
        byKeyword.set(key, row);
      }
    }
  }
  return [...byKeyword.values()].toSorted((a, b) =>
    a.keyword.localeCompare(b.keyword),
  );
}

function upsertKeywords(database, configId, keywords) {
  const statement = database.prepare(
    `INSERT INTO rank_tracking_keywords
      (id, config_id, keyword, search_volume, keyword_difficulty, cpc,
       metrics_fetched_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(config_id, keyword) DO UPDATE SET
       search_volume = coalesce(rank_tracking_keywords.search_volume, excluded.search_volume),
       keyword_difficulty = coalesce(rank_tracking_keywords.keyword_difficulty, excluded.keyword_difficulty),
       cpc = coalesce(rank_tracking_keywords.cpc, excluded.cpc),
       metrics_fetched_at = coalesce(rank_tracking_keywords.metrics_fetched_at, excluded.metrics_fetched_at)`,
  );
  for (const row of keywords) {
    statement.run(
      deterministicUuid(
        `target-keyword:${configId}:${normalizeKeyword(row.keyword)}`,
      ),
      configId,
      row.keyword,
      row.search_volume,
      row.keyword_difficulty,
      row.cpc,
      row.metrics_fetched_at,
      row.created_at ?? new Date().toISOString(),
    );
  }
}

function assertSchema(database) {
  const tables = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  for (const table of [
    "rank_history_sources",
    "rank_check_runs",
    "rank_snapshots",
    "rank_tracking_configs",
    "rank_tracking_keywords",
  ]) {
    if (!tables.has(table)) {
      throw new Error(`Required migrated table is missing: ${table}`);
    }
  }
}

async function verifyArchive(root, sourceManifest) {
  for (const entry of sourceManifest.campaigns) {
    const value = await readFile(path.join(root, entry.filename), "utf8");
    if (sha256(value) !== entry.sha256) {
      throw new Error(`Archive checksum mismatch: ${entry.filename}`);
    }
  }
}

function parseArgs(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith("--")) throw new Error(`Invalid argument: ${key}`);
    const name = key.slice(2);
    if (name === "apply") {
      parsed.set(name, true);
      continue;
    }
    const value = values[index + 1];
    if (value == null) throw new Error(`--${name} requires a value`);
    parsed.set(name, value);
    index += 1;
  }
  return parsed;
}

function requiredArg(parsed, name) {
  const value = parsed.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function deterministicUuid(value) {
  const bytes = Buffer.from(
    createHash("sha256").update(value).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeDomain(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");
}

function normalizeKeyword(value) {
  return String(value).trim().toLocaleLowerCase();
}

function canonicalLocation(value) {
  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(",");
}

function countryLocationCode(value) {
  const code = String(value ?? "").toLowerCase();
  if (code === "us") return 2840;
  if (code === "ph") return 2608;
  if (code === "ca") return 2124;
  throw new Error(`Unsupported campaign country code: ${code}`);
}

function historyTimestamp(value) {
  if (!/^\d{8}$/.test(value)) throw new Error(`Invalid SEMrush date: ${value}`);
  // SEMrush position history is day-granular. Anchor it at the start of the
  // UTC day using the same sortable text format as SQLite CURRENT_TIMESTAMP,
  // so an import never appears newer than a live check from that day.
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} 00:00:00`;
}

function objectValues(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function arrayValues(value) {
  return objectValues(value).filter((item) => typeof item === "string");
}

function firstScalar(value) {
  if (value == null || typeof value !== "object") return value;
  for (const child of Object.values(value)) {
    const scalar = firstScalar(child);
    if (scalar != null) return scalar;
  }
  return null;
}

function normalizePosition(value) {
  const position = Number(value);
  return Number.isInteger(position) && position >= 1 && position <= 100
    ? position
    : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function scoreMetrics(row) {
  return [row.search_volume, row.keyword_difficulty, row.cpc].filter(
    (value) => value != null,
  ).length;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
