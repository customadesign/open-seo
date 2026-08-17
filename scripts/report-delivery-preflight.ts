/**
 * Read-only deployment preflight for the report delivery tables.
 *
 * Answers the two questions that decide whether the delivery migrations are
 * safe to apply to a live deployment:
 *
 *   1. Which migrations does the target database already record?
 *   2. Does it still carry rows in the legacy `report_*` tables from the
 *      earlier reporting prototype, and are any of them orphaned (pointing at a
 *      project that no longer exists)?
 *
 * It only ever issues SELECTs. Run it before `db:migrate:prod` /
 * `db:migrate:pg`:
 *
 *   pnpm exec tsx scripts/report-delivery-preflight.ts --provider postgres
 *   pnpm exec tsx scripts/report-delivery-preflight.ts --provider d1 --database open-seo
 *   pnpm exec tsx scripts/report-delivery-preflight.ts --provider d1 --database open-seo --local
 */
import { execFileSync } from "node:child_process";
import process from "node:process";
import { loadLocalEnv, parseArgs } from "./cli-utils";

export type PreflightProvider = "d1" | "postgres";

/**
 * Tables from the superseded `report_*` prototype. The shipped model is
 * `monthly_report_*`, so any rows here are leftovers: they are never read by
 * the application and are what a cleanup migration would have to account for.
 */
export const LEGACY_REPORT_TABLES = [
  "report_templates",
  "report_template_sections",
  "report_schedules",
  "report_recipients",
  "report_runs",
  "report_artifacts",
  "report_share_links",
  "report_deliveries",
] as const;

/** Legacy tables that carry a project reference, so "orphaned" is meaningful. */
const PROJECT_SCOPED_LEGACY_TABLES = new Set([
  "report_schedules",
  "report_runs",
  "report_templates",
]);

export function migrationsQuery(provider: PreflightProvider): string {
  return provider === "postgres"
    ? `SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 20`
    : // wrangler's D1 migration bookkeeping; a drizzle-migrated SQLite file uses
      // __drizzle_migrations instead, so try both and ignore the missing one.
      `SELECT name, applied_at FROM d1_migrations ORDER BY applied_at DESC LIMIT 20`;
}

export function existingTablesQuery(provider: PreflightProvider): string {
  const names = LEGACY_REPORT_TABLES.map((table) => `'${table}'`).join(", ");
  return provider === "postgres"
    ? `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (${names})`
    : `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${names})`;
}

export function legacyRowCountQuery(table: string): string {
  if (
    !LEGACY_REPORT_TABLES.includes(
      table as (typeof LEGACY_REPORT_TABLES)[number],
    )
  ) {
    throw new Error(`Refusing to inspect unknown table: ${table}`);
  }
  if (!PROJECT_SCOPED_LEGACY_TABLES.has(table)) {
    return `SELECT COUNT(*) AS total, 0 AS orphaned FROM ${table}`;
  }
  return `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM projects WHERE projects.id = ${table}.project_id)) AS orphaned FROM ${table}`;
}

/** SQLite has no FILTER clause; the same shape written as a SUM. */
export function legacyRowCountQuerySqlite(table: string): string {
  if (!PROJECT_SCOPED_LEGACY_TABLES.has(table)) {
    return legacyRowCountQuery(table);
  }
  return `SELECT COUNT(*) AS total, SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM projects WHERE projects.id = ${table}.project_id) THEN 1 ELSE 0 END) AS orphaned FROM ${table}`;
}

export type LegacyTableReport = {
  table: string;
  total: number;
  orphaned: number;
};

export function formatPreflightReport(input: {
  provider: PreflightProvider;
  migrations: string[];
  legacyTables: LegacyTableReport[];
}): string {
  const lines = [
    `Report delivery preflight (${input.provider})`,
    "",
    "Applied migrations (most recent first):",
    ...(input.migrations.length > 0
      ? input.migrations.map((entry) => `  - ${entry}`)
      : ["  (no migration bookkeeping table found)"]),
    "",
    "Legacy report_* tables:",
  ];
  if (input.legacyTables.length === 0) {
    lines.push("  none present — nothing to clean up");
  } else {
    for (const row of input.legacyTables) {
      lines.push(
        `  - ${row.table}: ${row.total} row(s), ${row.orphaned} orphaned`,
      );
    }
    const orphaned = input.legacyTables.reduce(
      (total, row) => total + row.orphaned,
      0,
    );
    lines.push(
      "",
      orphaned > 0
        ? `Resolve ${orphaned} orphaned legacy row(s) before adding foreign keys to those tables.`
        : "No orphaned legacy rows. A drop-table cleanup can be scheduled independently.",
    );
  }
  return lines.join("\n");
}

type Row = Record<string, unknown>;

function runD1(database: string, local: boolean, sql: string): Row[] {
  const output = execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      database,
      local ? "--local" : "--remote",
      "--json",
      "--command",
      sql,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const parsed = JSON.parse(output) as Array<{ results?: Row[] }>;
  return parsed[0]?.results ?? [];
}

async function runPostgres(sql: string): Promise<Row[]> {
  const { default: postgres } = await import("postgres");
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      "Set DATABASE_URL (or POSTGRES_URL) for --provider postgres",
    );
  }
  const sql_ = postgres(connectionString, { max: 1 });
  try {
    return (await sql_.unsafe(sql)) as unknown as Row[];
  } finally {
    await sql_.end({ timeout: 5 });
  }
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const provider = (args.provider ?? "postgres") as PreflightProvider;
  if (provider !== "postgres" && provider !== "d1") {
    throw new Error("--provider must be 'postgres' or 'd1'");
  }
  const database = args.database ?? "DB";
  const local = args.local === "true";
  const query = (sql: string) =>
    provider === "postgres"
      ? runPostgres(sql)
      : Promise.resolve(runD1(database, local, sql));

  let migrations: string[] = [];
  try {
    const rows = await query(migrationsQuery(provider));
    migrations = rows.map((row) =>
      Object.values(row)
        .map((value) => String(value))
        .join("  "),
    );
  } catch (error) {
    console.warn(
      `Could not read migration bookkeeping: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const present = new Set(
    (await query(existingTablesQuery(provider))).map((row) => String(row.name)),
  );
  const legacyTables: LegacyTableReport[] = [];
  for (const table of LEGACY_REPORT_TABLES) {
    if (!present.has(table)) continue;
    const [row] = await query(
      provider === "postgres"
        ? legacyRowCountQuery(table)
        : legacyRowCountQuerySqlite(table),
    );
    legacyTables.push({
      table,
      total: toNumber(row?.total),
      orphaned: toNumber(row?.orphaned),
    });
  }

  console.log(formatPreflightReport({ provider, migrations, legacyTables }));
}

if (process.argv[1]?.endsWith("report-delivery-preflight.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
