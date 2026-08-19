import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runArchive } from "./archive";
import { runImport } from "./import";
import {
  type ArchiveManifest,
  loadArchiveManifest,
  redactSecrets,
  recordFile,
  writeArchiveState,
} from "./shared";

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
);
const fixedNow = () => new Date("2026-08-13T00:00:00.000Z");
const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("SEMrush archive", () => {
  it("resumes paginated endpoints from the last checksummed page", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "semrush-archive-resume-"),
    );
    const outputDir = path.join(root, "archive");
    const apiKey = "fixture-api-key-never-log";
    const projects = await fixture("archive-projects.json");
    const ranks = await fixture("domain-ranks.csv");
    const pageOne = await fixture("organic-page-1.csv");
    const pageTwo = await fixture("organic-page-2.csv");

    const firstFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/management/v1/projects"))
        return response(projects);
      if (url.searchParams.get("type") === "domain_ranks")
        return response(ranks);
      if (url.searchParams.get("display_offset") === "0")
        return response(pageOne);
      return response("temporary outage", 503);
    });

    await expect(
      runArchive({
        outputDir,
        apiKey,
        domains: ["example.com"],
        databases: ["us"],
        pageSize: 2,
        maxRetries: 0,
        fetchImpl: firstFetch as typeof fetch,
        sleep: async () => undefined,
        now: fixedNow,
        logger: silentLogger,
      }),
    ).rejects.toThrow("HTTP 503");

    const interrupted = await loadArchiveManifest(outputDir);
    const organic =
      interrupted.endpoints["analytics.domain_organic.us.example.com"];
    expect(organic.status).toBe("failed");
    expect(organic.nextOffset).toBe(2);
    expect(organic.pages).toHaveLength(1);

    const resumeFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("type")).toBe("domain_organic");
      expect(url.searchParams.get("display_offset")).toBe("2");
      return response(pageTwo);
    });
    const completed = await runArchive({
      outputDir,
      apiKey,
      domains: ["example.com"],
      databases: ["us"],
      pageSize: 2,
      maxRetries: 0,
      fetchImpl: resumeFetch as typeof fetch,
      sleep: async () => undefined,
      now: fixedNow,
      logger: silentLogger,
    });

    expect(resumeFetch).toHaveBeenCalledTimes(1);
    expect(
      completed?.endpoints["analytics.domain_organic.us.example.com"].status,
    ).toBe("complete");
    expect(completed?.completedAt).toBe("2026-08-13T00:00:00.000Z");

    const noFetch = vi.fn();
    await runArchive({
      outputDir,
      apiKey,
      domains: ["example.com"],
      databases: ["us"],
      pageSize: 2,
      maxRetries: 0,
      fetchImpl: noFetch as typeof fetch,
      now: fixedNow,
      logger: silentLogger,
    });
    expect(noFetch).not.toHaveBeenCalled();
  });

  it("redacts the API key from errors and persisted checkpoints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semrush-redaction-"));
    const outputDir = path.join(root, "archive");
    const apiKey = "super-secret-token-value";
    const fetchImpl = vi.fn(async () =>
      response(`failed key=${apiKey} SEMRUSH_API_KEY=${apiKey}`, 500),
    );

    let caught: Error | null = null;
    try {
      await runArchive({
        outputDir,
        apiKey,
        domains: ["example.com"],
        maxRetries: 0,
        fetchImpl: fetchImpl as typeof fetch,
        now: fixedNow,
        logger: silentLogger,
      });
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught?.message).not.toContain(apiKey);
    expect(caught?.cause).toBeUndefined();
    expect(redactSecrets(caught)).not.toContain(apiKey);
    const manifestText = await readFile(
      path.join(outputDir, "manifest.json"),
      "utf8",
    );
    expect(manifestText).not.toContain(apiKey);
    expect(manifestText).toContain("[REDACTED]");
  });

  it("records body-level SEMrush failures as failed checkpoints", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semrush-body-error-"));
    const outputDir = path.join(root, "archive");
    const apiKey = "body-error-secret";

    await expect(
      runArchive({
        outputDir,
        apiKey,
        domains: ["example.com"],
        fetchImpl: vi.fn(async () =>
          response(`ERROR 120 :: WRONG KEY ${apiKey}`),
        ) as typeof fetch,
        now: fixedNow,
        logger: silentLogger,
      }),
    ).rejects.toThrow("WRONG KEY");

    const manifest = await loadArchiveManifest(outputDir);
    expect(manifest.endpoints["management.projects"]).toMatchObject({
      status: "failed",
    });
    expect(manifest.endpoints["management.projects"].error).not.toContain(
      apiKey,
    );
  });

  it("stores NOTHING FOUND as explicit evidence instead of CSV", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semrush-empty-"));
    const outputDir = path.join(root, "archive");
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/management/v1/projects")) {
        return response("[]");
      }
      return response("ERROR 50 :: NOTHING FOUND");
    });

    const manifest = await runArchive({
      outputDir,
      apiKey: "fixture-key",
      domains: ["example.com"],
      pageSize: 2,
      fetchImpl: fetchImpl as typeof fetch,
      now: fixedNow,
      logger: silentLogger,
    });

    expect(manifest?.endpoints).toMatchObject({
      "analytics.domain_ranks.us.example.com": {
        status: "complete",
        nothingFound: true,
      },
      "analytics.domain_organic.us.example.com": {
        status: "complete",
        nothingFound: true,
      },
    });
    const evidenceFiles = Object.entries(manifest?.files ?? {}).filter(
      ([, file]) => file.contentType === "text/plain",
    );
    expect(evidenceFiles.map(([relativePath]) => relativePath)).toEqual([
      "raw/analytics/us/example.com/domain-ranks.nothing-found.txt",
      "raw/analytics/us/example.com/domain-organic/nothing-found-offset-00000000.txt",
    ]);

    const bundleDir = path.join(root, "bundle");
    await runImport({
      inputDir: outputDir,
      outputDir: bundleDir,
      now: fixedNow,
      logger: silentLogger,
    });
    const reconciliation = JSON.parse(
      await readFile(path.join(bundleDir, "reconciliation.json"), "utf8"),
    );
    expect(reconciliation.emptyAnalyticsEndpoints).toEqual([
      "analytics.domain_organic.us.example.com",
      "analytics.domain_ranks.us.example.com",
    ]);
  });
});

describe("SEMrush import", () => {
  it("rejects a source file whose checksum no longer matches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semrush-checksum-"));
    const inputDir = path.join(root, "archive");
    const outputDir = path.join(root, "bundle");
    await buildImportFixtureArchive(inputDir);
    await writeFile(
      path.join(inputDir, "raw/management/projects.json"),
      "tampered\n",
    );

    await expect(
      runImport({ inputDir, outputDir, now: fixedNow, logger: silentLogger }),
    ).rejects.toThrow("Checksum verification failed");
    await expect(
      readFile(path.join(outputDir, "import-manifest.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("builds a normalized bundle and reconciliation summary from fixtures", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semrush-import-"));
    const inputDir = path.join(root, "archive");
    const outputDir = path.join(root, "bundle");
    await buildImportFixtureArchive(inputDir);

    await runImport({
      inputDir,
      outputDir,
      now: fixedNow,
      logger: silentLogger,
    });

    const reconciliation = JSON.parse(
      await readFile(path.join(outputDir, "reconciliation.json"), "utf8"),
    );
    expect(reconciliation.counts).toMatchObject({
      sourceProjects: 3,
      normalizedProjects: 3,
      sourceDomainSnapshotRows: 2,
      normalizedDomainSnapshots: 2,
      sourceOrganicRows: 6,
      normalizedOrganicKeywords: 3,
      malformedRows: 1,
      exactDuplicatesRemoved: 1,
      conflictingRows: 1,
      matchedDomains: 1,
      analyticsDomainsWithoutProject: 1,
      projectsWithoutAnalytics: 1,
    });
    expect(reconciliation.duplicateProjectDomains).toEqual([
      { domain: "example.com", sourceProjectIds: ["201", "202"] },
    ]);
    expect(reconciliation.analyticsDomainsWithoutProject).toEqual([
      "orphan.test",
    ]);
    expect(reconciliation.projectsWithoutAnalytics).toEqual([
      {
        sourceProjectId: "203",
        name: "Missing analytics",
        domain: "missing.test",
      },
    ]);

    const organicRows = readNdjson(
      await readFile(
        path.join(outputDir, "normalized/organic-keywords.ndjson"),
        "utf8",
      ),
    );
    expect(organicRows).toHaveLength(3);
    expect(
      organicRows.find((row) => row.keyword === "blue widgets")?.position,
    ).toBe(1);

    const before = await readFile(
      path.join(outputDir, "checksums.sha256"),
      "utf8",
    );
    await unlink(path.join(outputDir, "checksums.sha256"));
    await runImport({
      inputDir,
      outputDir,
      now: fixedNow,
      logger: silentLogger,
    });
    const after = await readFile(
      path.join(outputDir, "checksums.sha256"),
      "utf8",
    );
    expect(after).toBe(before);
  });

  it("refuses an incomplete source unless the diagnostic override is explicit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "semrush-incomplete-"));
    const inputDir = path.join(root, "archive");
    const outputDir = path.join(root, "bundle");
    await buildImportFixtureArchive(inputDir);
    const archive = await loadArchiveManifest(inputDir);
    archive.completedAt = undefined;
    const failed = archive.endpoints["analytics.domain_organic.us.example.com"];
    failed.status = "failed";
    failed.error = "fixture interruption";
    await writeArchiveState(inputDir, archive);

    await expect(
      runImport({ inputDir, outputDir, now: fixedNow, logger: silentLogger }),
    ).rejects.toThrow("Source archive is incomplete");

    await runImport({
      inputDir,
      outputDir,
      allowIncompleteSource: true,
      now: fixedNow,
      logger: silentLogger,
    });
    const reconciliation = JSON.parse(
      await readFile(path.join(outputDir, "reconciliation.json"), "utf8"),
    );
    expect(reconciliation.sourceArchiveCompletedAt).toBeNull();
    expect(reconciliation.incompleteEndpoints).toEqual([
      {
        id: "analytics.domain_organic.us.example.com",
        status: "failed",
        error: "fixture interruption",
      },
    ]);
  });
});

async function buildImportFixtureArchive(root: string): Promise<void> {
  const createdAt = fixedNow().toISOString();
  const manifest: ArchiveManifest = {
    schemaVersion: 1,
    kind: "semrush-archive",
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
    options: {
      databases: ["us"],
      domains: ["example.com", "orphan.test"],
      domainSource: "explicit",
      pageSize: 1_000,
      maxPages: 10,
    },
    endpoints: {},
    files: {},
  };

  await addFixture(
    root,
    manifest,
    "management.projects",
    "management",
    "projects",
    "raw/management/projects.json",
    "import-projects.json",
  );
  await addFixture(
    root,
    manifest,
    "analytics.domain_ranks.us.example.com",
    "analytics",
    "domain_ranks",
    "raw/analytics/us/example.com/domain-ranks.csv",
    "import-ranks-example.csv",
    "example.com",
  );
  await addFixture(
    root,
    manifest,
    "analytics.domain_ranks.us.orphan.test",
    "analytics",
    "domain_ranks",
    "raw/analytics/us/orphan.test/domain-ranks.csv",
    "import-ranks-orphan.csv",
    "orphan.test",
  );
  await addFixture(
    root,
    manifest,
    "analytics.domain_organic.us.example.com",
    "analytics",
    "domain_organic",
    "raw/analytics/us/example.com/domain-organic/page-000001.csv",
    "import-organic-example.csv",
    "example.com",
  );
  await addFixture(
    root,
    manifest,
    "analytics.domain_organic.us.orphan.test",
    "analytics",
    "domain_organic",
    "raw/analytics/us/orphan.test/domain-organic/page-000001.csv",
    "import-organic-orphan.csv",
    "orphan.test",
  );
  await writeArchiveState(root, manifest);
}

async function addFixture(
  root: string,
  manifest: ArchiveManifest,
  endpointId: string,
  api: "management" | "analytics",
  type: string,
  relativePath: string,
  fixtureName: string,
  domain?: string,
): Promise<void> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(fixtureDir, fixtureName), target);
  manifest.endpoints[endpointId] = {
    id: endpointId,
    api,
    type,
    domain,
    database: api === "analytics" ? "us" : undefined,
    status: "complete",
    attempts: 1,
    pages: type === "domain_organic" ? [relativePath] : undefined,
    updatedAt: fixedNow().toISOString(),
  };
  manifest.files[relativePath] = await recordFile(root, relativePath, {
    contentType: relativePath.endsWith(".json")
      ? "application/json"
      : "text/csv",
    endpointId,
  });
}

async function fixture(name: string): Promise<string> {
  return readFile(path.join(fixtureDir, name), "utf8");
}

function response(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain" },
  });
}

function readNdjson(content: string): Array<Record<string, unknown>> {
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
