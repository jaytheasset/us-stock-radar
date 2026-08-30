import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import test from "node:test";

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
  requireServerPostgresUrl,
  withServerPostgresClient,
  withServerPostgresTransaction,
} = await import("./serverPostgres.ts");
type ServerPostgresClient = import("./serverPostgres.ts").ServerPostgresClient;
type ServerPostgresPool = import("./serverPostgres.ts").ServerPostgresPool;

test("missing SUPABASE_DB_URL fails clearly without credentials", () => {
  const unrelatedSecret = "postgresql://user:do-not-leak@remote.example/db";
  assert.throws(
    () => requireServerPostgresUrl({ UNRELATED_SECRET: unrelatedSecret }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /SUPABASE_DB_URL is required/);
      assert.equal(error.message.includes(unrelatedSecret), false);
      assert.equal(error.message.includes("do-not-leak"), false);
      return true;
    },
  );
});

test("transaction work, control statements, and release use one PoolClient", async () => {
  const fixture = createPoolFixture();
  let operationClient: ServerPostgresClient | undefined;

  const result = await withServerPostgresTransaction(async (client) => {
    operationClient = client;
    await client.query("SELECT 1");
    return "done";
  }, fixture.pool);

  assert.equal(result, "done");
  assert.equal(operationClient, fixture.client);
  assert.equal(fixture.connectCount, 1);
  assert.deepEqual(fixture.queries, [
    "BEGIN",
    "SET LOCAL statement_timeout = '30s'",
    "SELECT 1",
    "COMMIT",
  ]);
  assert.equal(fixture.releaseCount, 1);
});

test("client lifecycle releases on success and failure", async () => {
  const success = createPoolFixture();
  assert.equal(
    await withServerPostgresClient(async (client) => {
      assert.equal(client, success.client);
      return "success";
    }, success.pool),
    "success",
  );
  assert.equal(success.releaseCount, 1);

  const failure = createPoolFixture();
  const expected = new Error("client operation failed");
  await assert.rejects(
    withServerPostgresClient(async (client) => {
      assert.equal(client, failure.client);
      throw expected;
    }, failure.pool),
    (error: unknown) => error === expected,
  );
  assert.equal(failure.releaseCount, 1);
});

test("operation failure rolls back and releases the same PoolClient", async () => {
  const fixture = createPoolFixture();
  const expected = new Error("operation failed");

  await assert.rejects(
    withServerPostgresTransaction(async (client) => {
      assert.equal(client, fixture.client);
      throw expected;
    }, fixture.pool),
    (error: unknown) => error === expected,
  );

  assert.deepEqual(fixture.queries, [
    "BEGIN",
    "SET LOCAL statement_timeout = '30s'",
    "ROLLBACK",
  ]);
  assert.equal(fixture.releaseCount, 1);
});

test("setup failure rolls back when BEGIN succeeded and always releases", async () => {
  const fixture = createPoolFixture({
    failOn: "SET LOCAL statement_timeout = '30s'",
  });

  await assert.rejects(
    withServerPostgresTransaction(async () => "unreachable", fixture.pool),
    /query failed/,
  );

  assert.deepEqual(fixture.queries, [
    "BEGIN",
    "SET LOCAL statement_timeout = '30s'",
    "ROLLBACK",
  ]);
  assert.equal(fixture.releaseCount, 1);
});

test("helper is server-only and creates a one-connection pg.Pool", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "lib/serverPostgres.ts"),
    "utf8",
  );
  assert.match(source, /^import "server-only";/);
  assert.match(source, /new pg\.Pool\(\{/);
  assert.match(source, /max: 1/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_/);
});

function createPoolFixture({ failOn }: { failOn?: string } = {}) {
  const state = {
    connectCount: 0,
    queries: [] as string[],
    releaseCount: 0,
  };
  const client: ServerPostgresClient = {
    async query<Row extends Record<string, unknown>>(text: string) {
      state.queries.push(text);
      if (text === failOn) throw new Error("query failed");
      return { rows: [] as Row[], rowCount: 0 };
    },
    release() {
      state.releaseCount += 1;
    },
  };
  const pool: ServerPostgresPool = {
    async connect() {
      state.connectCount += 1;
      return client;
    },
    async end() {},
  };
  return {
    client,
    pool,
    get connectCount() {
      return state.connectCount;
    },
    get queries() {
      return state.queries;
    },
    get releaseCount() {
      return state.releaseCount;
    },
  };
}
