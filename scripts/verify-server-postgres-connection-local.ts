import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20%7B%7D;",
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  createServerPostgresPool,
  withServerPostgresClient,
} = await import("../lib/serverPostgres.ts");

const connectionString = process.env.SUPABASE_LOCAL_DB_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const databaseUrl = new URL(connectionString);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname)) {
  throw new Error("Refusing non-local PostgreSQL connection");
}

const pool = createServerPostgresPool({ SUPABASE_DB_URL: connectionString });
try {
  await withServerPostgresClient(async (client) => {
    let rolledBack = false;
    try {
      await client.query("BEGIN");
      const before = await client.query<{ pid: number }>(
        "SELECT pg_backend_pid()::integer AS pid",
      );
      await client.query("SET LOCAL statement_timeout = '5s'");
      const readOnly = await client.query<{ ok: number }>(
        "SELECT 1::integer AS ok",
      );
      const after = await client.query<{ pid: number }>(
        "SELECT pg_backend_pid()::integer AS pid",
      );
      assert.equal(readOnly.rows[0]?.ok, 1);
      assert.equal(before.rows[0]?.pid, after.rows[0]?.pid);
      await client.query("ROLLBACK");
      rolledBack = true;
    } finally {
      if (!rolledBack) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original failure while still attempting cleanup.
        }
      }
    }
  }, pool);
  process.stdout.write(JSON.stringify({
    begin: true,
    sameBackendPid: true,
    setLocal: true,
    readOnlyQuery: true,
    rollback: true,
    released: true,
    productTableWrites: 0,
  }));
} finally {
  await pool.end();
}
