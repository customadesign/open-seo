import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MAX_REPORT_DELIVERY_ATTEMPTS } from "@/shared/report-delivery";
import type * as ReportDeliveryRepositoryModule from "./ReportDeliveryRepository";

// Real in-memory SQLite so the attempt-budget filter, the operator reset and
// the share-link revocation predicate run against actual SQL.

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));

let client: Client;
let ReportDeliveryRepository: typeof ReportDeliveryRepositoryModule.ReportDeliveryRepository;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  vi.doMock("@/db", () => ({ db: drizzle(client) }));

  await client.executeMultiple(`
    CREATE TABLE monthly_report_deliveries (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      profile_id TEXT,
      recipient_id TEXT,
      email TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      idempotency_key TEXT NOT NULL,
      provider_message_id TEXT,
      error_message TEXT,
      is_test INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE monthly_report_share_links (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_by_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ({ ReportDeliveryRepository } = await import("./ReportDeliveryRepository"));
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM monthly_report_deliveries;
    DELETE FROM monthly_report_share_links;
  `);
});

async function insertDelivery(overrides: {
  id: string;
  status: string;
  attempts: number;
}) {
  await client.execute({
    sql: `INSERT INTO monthly_report_deliveries
            (id, run_id, email, status, attempts, idempotency_key)
          VALUES (?, 'run-1', ?, ?, ?, ?)`,
    args: [
      overrides.id,
      `${overrides.id}@acme.test`,
      overrides.status,
      overrides.attempts,
      `report:run-1:${overrides.id}`,
    ],
  });
}

async function insertShareLink(overrides: {
  id: string;
  expiresAt: string;
  revokedAt?: string;
}) {
  await client.execute({
    sql: `INSERT INTO monthly_report_share_links
            (id, run_id, token_hash, expires_at, revoked_at)
          VALUES (?, 'run-1', ?, ?, ?)`,
    args: [
      overrides.id,
      `hash-${overrides.id}`,
      overrides.expiresAt,
      overrides.revokedAt ?? null,
    ],
  });
}

describe("resetFailedDeliveries", () => {
  // Without clearing attempts, a recipient that burned the whole budget is
  // parked as pending forever: the operator's retry reports a reset row that
  // listSendableDeliveries then refuses to send.
  it("makes a recipient that exhausted its attempts sendable again", async () => {
    await insertDelivery({
      id: "exhausted",
      status: "failed",
      attempts: MAX_REPORT_DELIVERY_ATTEMPTS,
    });

    expect(await ReportDeliveryRepository.resetFailedDeliveries("run-1")).toBe(
      1,
    );
    const sendable = await ReportDeliveryRepository.listSendableDeliveries(
      "run-1",
      MAX_REPORT_DELIVERY_ATTEMPTS,
    );
    expect(sendable).toMatchObject([
      { id: "exhausted", status: "pending", attempts: 0, errorMessage: null },
    ]);
  });

  it("leaves sent and held-back rows alone", async () => {
    await insertDelivery({ id: "sent", status: "sent", attempts: 1 });
    await insertDelivery({ id: "skipped", status: "skipped", attempts: 0 });

    expect(await ReportDeliveryRepository.resetFailedDeliveries("run-1")).toBe(
      0,
    );
    expect(
      await ReportDeliveryRepository.listSendableDeliveries(
        "run-1",
        MAX_REPORT_DELIVERY_ATTEMPTS,
      ),
    ).toEqual([]);
  });
});

describe("revokeShareLinksForRun", () => {
  // Every delivery attempt mints a new token because only its hash is stored;
  // revoking first keeps one live unauthenticated URL per run.
  it("revokes the live links and leaves expired or already-revoked ones", async () => {
    const now = "2026-08-18T00:00:00.000Z";
    await insertShareLink({
      id: "live",
      expiresAt: "2026-09-01T00:00:00.000Z",
    });
    await insertShareLink({
      id: "expired",
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    await insertShareLink({
      id: "already-revoked",
      expiresAt: "2026-09-01T00:00:00.000Z",
      revokedAt: "2026-08-10T00:00:00.000Z",
    });

    expect(
      await ReportDeliveryRepository.revokeShareLinksForRun("run-1", now),
    ).toBe(1);
    const rows = await ReportDeliveryRepository.listShareLinks("run-1");
    expect(
      Object.fromEntries(rows.map((row) => [row.id, row.revokedAt])),
    ).toEqual({
      live: now,
      expired: null,
      "already-revoked": "2026-08-10T00:00:00.000Z",
    });
  });
});
