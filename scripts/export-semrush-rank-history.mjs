#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const inventoryPath = requiredArg(args, "inventory");
const outputDir = requiredArg(args, "output");
const maxApiUnits = Number(requiredArg(args, "max-api-units"));
const apiKey = process.env.SEMRUSH_API_KEY;
if (!apiKey) throw new Error("SEMRUSH_API_KEY is required");
if (!Number.isFinite(maxApiUnits) || maxApiUnits <= 0) {
  throw new Error("--max-api-units must be a positive number");
}

const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
const campaigns = inventory.campaigns ?? [];
const expectedFullArchiveUnits =
  campaigns.length * 100 +
  campaigns.reduce(
    (sum, campaign) => sum + Number(campaign.keywords?.length ?? 0) * 100,
    0,
  );
if (expectedFullArchiveUnits > maxApiUnits) {
  throw new Error(
    `Projected SEMrush spend ${expectedFullArchiveUnits} exceeds approved ceiling ${maxApiUnits}`,
  );
}

await mkdir(path.join(outputDir, "campaigns"), {
  recursive: true,
  mode: 0o700,
});
const existingEntries = new Map();
for (const campaign of campaigns) {
  const entry = await readExistingCampaign(outputDir, campaign);
  if (entry) existingEntries.set(campaign.id, entry);
}
const pendingCampaigns = campaigns.filter(
  (campaign) => !existingEntries.has(campaign.id),
);
const projectedUnits =
  pendingCampaigns.length * 100 +
  pendingCampaigns.reduce(
    (sum, campaign) => sum + Number(campaign.keywords?.length ?? 0) * 100,
    0,
  );
const balanceBefore = await getBalance(apiKey);
if (balanceBefore < projectedUnits) {
  throw new Error(
    `SEMrush balance ${balanceBefore} is below projected remaining spend ${projectedUnits}`,
  );
}

const campaignEntries = [];
for (const [index, campaign] of campaigns.entries()) {
  const existingEntry = existingEntries.get(campaign.id);
  if (existingEntry) {
    process.stderr.write(
      `SEMrush history ${index + 1}/${campaigns.length}: ${campaign.projectName} / ${campaign.engine} (reused)\n`,
    );
    campaignEntries.push(existingEntry);
    continue;
  }
  process.stderr.write(
    `SEMrush history ${index + 1}/${campaigns.length}: ${campaign.projectName} / ${campaign.engine}\n`,
  );
  const datesResponse = await report(apiKey, campaign.id, {
    action: "report",
    type: "tracking_campaign_dates",
  });
  const dates = objectValues(datesResponse.data)
    .map((row) => String(row.Dt ?? ""))
    .filter(Boolean)
    .toSorted();

  let positionsResponse = null;
  if ((campaign.keywords?.length ?? 0) > 0 && dates.length > 0) {
    positionsResponse = await report(apiKey, campaign.id, {
      action: "report",
      type: "tracking_position_organic",
      url: campaignMask(campaign),
      date_begin: dates[0],
      date_end: dates.at(-1),
      display_limit: Math.max(campaign.keywords.length, 1),
      display_offset: 0,
      display_sort: "ph_asc",
      linktype_filter: 0,
    });
    const total = Number(positionsResponse.total ?? 0);
    const rowCount = objectValues(positionsResponse.data).length;
    if (
      total !== campaign.keywords.length ||
      rowCount !== campaign.keywords.length
    ) {
      throw new Error(
        `Campaign ${campaign.id} returned total=${total}, rows=${rowCount}; expected ${campaign.keywords.length}`,
      );
    }
  }

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    campaign,
    datesResponse,
    positionsResponse,
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const filename = `${campaign.id}.json`;
  await atomicWrite(path.join(outputDir, "campaigns", filename), json);
  campaignEntries.push({
    campaignId: campaign.id,
    projectName: campaign.projectName,
    engine: campaign.engine,
    keywordCount: campaign.keywords.length,
    dateCount: dates.length,
    filename: `campaigns/${filename}`,
    sha256: sha256(json),
  });
}

const balanceAfter = await getBalance(apiKey);
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceInventory: path.resolve(inventoryPath),
  campaignCount: campaignEntries.length,
  keywordEntries: campaignEntries.reduce(
    (sum, campaign) => sum + campaign.keywordCount,
    0,
  ),
  expectedApiUnits: expectedFullArchiveUnits,
  apiUnits: {
    before: balanceBefore,
    after: balanceAfter,
    consumed: balanceBefore - balanceAfter,
    projectedThisRun: projectedUnits,
  },
  reusedCampaignCount: existingEntries.size,
  campaigns: campaignEntries,
};
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
await atomicWrite(path.join(outputDir, "manifest.json"), manifestJson);
await atomicWrite(
  path.join(outputDir, "SHA256SUMS"),
  `${campaignEntries
    .map((entry) => `${entry.sha256}  ${entry.filename}`)
    .join("\n")}\n${sha256(manifestJson)}  manifest.json\n`,
);
await writeFile(
  path.join(outputDir, "COMPLETE"),
  `${new Date().toISOString()}\n`,
  { mode: 0o600 },
);

process.stdout.write(
  `${JSON.stringify({
    outputDir,
    campaignCount: manifest.campaignCount,
    keywordEntries: manifest.keywordEntries,
    reusedCampaignCount: manifest.reusedCampaignCount,
    apiUnits: manifest.apiUnits,
  })}\n`,
);

async function readExistingCampaign(root, campaign) {
  const filename = `${campaign.id}.json`;
  const destination = path.join(root, "campaigns", filename);
  let json;
  try {
    json = await readFile(destination, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error(`Existing archive payload is invalid JSON: ${destination}`);
  }
  if (
    payload.schemaVersion !== 1 ||
    payload.campaign?.id !== campaign.id ||
    payload.campaign?.keywords?.length !== campaign.keywords.length
  ) {
    throw new Error(
      `Existing archive payload does not reconcile: ${destination}`,
    );
  }
  const dates = objectValues(payload.datesResponse?.data)
    .map((row) => String(row.Dt ?? ""))
    .filter(Boolean);
  const total = Number(payload.positionsResponse?.total ?? 0);
  const rowCount = objectValues(payload.positionsResponse?.data).length;
  if (
    campaign.keywords.length > 0 &&
    (total !== campaign.keywords.length ||
      rowCount !== campaign.keywords.length)
  ) {
    throw new Error(
      `Existing archive payload has an invalid total: ${destination}`,
    );
  }
  return {
    campaignId: campaign.id,
    projectName: campaign.projectName,
    engine: campaign.engine,
    keywordCount: campaign.keywords.length,
    dateCount: dates.length,
    filename: `campaigns/${filename}`,
    sha256: sha256(json),
  };
}

function parseArgs(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith("--") || values[index + 1] == null) {
      throw new Error(`Invalid argument near ${key ?? "end of command"}`);
    }
    parsed.set(key.slice(2), values[index + 1]);
  }
  return parsed;
}

function requiredArg(parsed, name) {
  const value = parsed.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function objectValues(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function campaignMask(campaign) {
  const rawUrl = String(campaign.trackedUrl)
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  switch (campaign.trackedUrlType) {
    case "rootdomain":
      return `*.${rawUrl}/*`;
    case "subdomain":
      return `${rawUrl}/*`;
    case "subfolder":
      return `*.${rawUrl}/*`;
    case "url":
      return campaign.trackedUrl;
    default:
      throw new Error(
        `Unsupported SEMrush campaign URL type: ${campaign.trackedUrlType}`,
      );
  }
}

async function getBalance(key) {
  const url = new URL("https://www.semrush.com/users/countapiunits.html");
  url.searchParams.set("key", key);
  const value = Number(await fetchText(url));
  if (!Number.isFinite(value)) throw new Error("Invalid SEMrush API balance");
  return value;
}

async function report(key, campaignId, parameters) {
  const url = new URL(
    `https://api.semrush.com/reports/v1/projects/${campaignId}/tracking/`,
  );
  url.searchParams.set("key", key);
  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, String(value));
  }
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Campaign ${campaignId} returned non-JSON: ${text.slice(0, 240)}`,
    );
  }
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "OpenSEO-SEMrush-History-Migration/1.0" },
      });
      const text = await response.text();
      if (response.ok) return text;
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      }
      lastError = new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  throw lastError;
}

async function atomicWrite(destination, content) {
  const temp = `${destination}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, destination);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
