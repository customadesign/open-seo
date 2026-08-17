import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../src/db/pg/schema";
import { projectR2KeyQueries, R2_KEY_COLUMNS } from "./gdpr-r2-inventory";

// postgres.js connects lazily, so building queries and reading their SQL never
// opens a socket.
const db = drizzle(postgres("postgres://erasure:test@127.0.0.1:5432/test"));

function schemaR2KeyColumns(): string[] {
  return Object.values(schema)
    .filter((value) => is(value, PgTable))
    .flatMap((table) =>
      Object.values(getTableColumns(table))
        .filter((column) => /(^|_)r2_key$|^storage_key$/u.test(column.name))
        .map((column) => `${getTableName(table)}.${column.name}`),
    );
}

describe("GDPR R2 inventory", () => {
  // An R2 key that survives the Postgres delete can never be found again, so a
  // new pointer column has to be added to the erasure, not just to the schema.
  it("covers every R2 pointer column in the Postgres schema", () => {
    expect(new Set(schemaR2KeyColumns())).toEqual(
      new Set(R2_KEY_COLUMNS.map((entry) => `${entry.table}.${entry.column}`)),
    );
  });

  it("reads each pointer scoped to the erased projects", () => {
    const statements = projectR2KeyQueries(db, ["project-1"]).map((query) =>
      query.toSQL(),
    );

    expect(statements).toHaveLength(R2_KEY_COLUMNS.length);
    statements.forEach((statement, index) => {
      expect(statement.sql).toContain(R2_KEY_COLUMNS[index].table);
      expect(statement.sql).toContain(R2_KEY_COLUMNS[index].column);
      expect(statement.sql).toContain("project_id");
      expect(statement.params).toEqual(["project-1"]);
    });
  });
});
