import assert from "node:assert/strict";
import { registerHooks } from "node:module";
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
  extractPeriodicOsIssuerCiks,
  runSecPeriodicOsTriggerBridge,
} = await import("./secPeriodicOsTriggerBridge.ts");
type ServerPostgresClient = import("./serverPostgres.ts").ServerPostgresClient;
type ServerPostgresPool = import("./serverPostgres.ts").ServerPostgresPool;

test("periodic form filtering accepts stored 10-Q/10-K/20-F/40-F filings and dedupes normalized CIKs", () => {
  const items = [
    stored("10-Q", "1840317"),
    stored("10-Q/A", "0001840317"),
    stored("10-K", 1840317),
    stored("10-K/A", "320193"),
    stored("20-F", "0000000001"),
    stored("20-F/A", "0000000001"),
    stored("40-F", "0000000004"),
    stored("40-F/A", "0000000004"),
    ...["6-K", "F-10", "8-K", "S-1", "S-3", "424B5"].map((form) =>
      stored(form, "0000000005")),
    { ...stored("10-Q", "0000000002"), ok: false },
    { ok: true, form_type: "10-Q", cik: "0000000003" },
    stored("10-Q", "bad-cik"),
  ];

  assert.deepEqual(extractPeriodicOsIssuerCiks(items), [
    "0000000001",
    "0000000004",
    "0000320193",
    "0001840317",
  ]);
});

test("bridge invokes the existing collector once per deduped CIK in incremental mode and releases the client", async () => {
  const fixture = createPoolFixture();
  const calls: Array<{ cik: string; mode: string }> = [];
  const result = await runSecPeriodicOsTriggerBridge({
    ciks: ["1840317", "0001840317", "320193"],
    environment: { SEC_USER_AGENT: "Stock Radar test test@example.com" },
    pool: fixture.pool,
  }, {
    createCollector: () => ({
      async collectIssuer(input) {
        calls.push(input);
        return completedResult(input.cik);
      },
    }),
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(calls, [
    { cik: "0000320193", mode: "incremental" },
    { cik: "0001840317", mode: "incremental" },
  ]);
  assert.equal(fixture.connectCount, 1);
  assert.equal(fixture.releaseCount, 1);
});

test("collector failure is isolated per CIK and the bridge resolves after releasing the client", async () => {
  const fixture = createPoolFixture();
  const calls: string[] = [];
  const result = await runSecPeriodicOsTriggerBridge({
    ciks: ["0001840317", "0000320193"],
    environment: { SEC_USER_AGENT: "Stock Radar test test@example.com" },
    pool: fixture.pool,
  }, {
    createCollector: () => ({
      async collectIssuer({ cik }) {
        calls.push(cik);
        if (cik === "0000320193") throw new Error("isolated collector failure");
        return completedResult(cik);
      },
    }),
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(calls, ["0000320193", "0001840317"]);
  assert.equal(result.issuerResults.length, 1);
  assert.deepEqual(result.failures, [{
    issuerCik: "0000320193",
    stage: "collector",
    error: "isolated collector failure",
  }]);
  assert.equal(fixture.releaseCount, 1);
});

test("BASELINE_REQUIRED is a serializable nonfatal issuer result and the bridge still releases its one client", async () => {
  const fixture = createPoolFixture();
  const result = await runSecPeriodicOsTriggerBridge({
    ciks: ["0000885462"],
    environment: { SEC_USER_AGENT: "Stock Radar test test@example.com" },
    pool: fixture.pool,
  }, {
    createCollector: () => ({
      async collectIssuer({ cik }) {
        return {
          ...completedResult(cik),
          status: "BASELINE_REQUIRED" as const,
          incrementalBaseline: {
            status: "BASELINE_REQUIRED" as const,
            cik,
            reason: "NO_USABLE_PERIODIC_BASELINE" as const,
          },
        };
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.issuerResults[0]?.status, "BASELINE_REQUIRED");
  assert.equal(result.issuerResults[0]?.incrementalBaseline?.status, "BASELINE_REQUIRED");
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(fixture.connectCount, 1);
  assert.equal(fixture.releaseCount, 1);
});

test("missing configuration and connection failure resolve as isolated bridge failures", async () => {
  const missing = await runSecPeriodicOsTriggerBridge({
    ciks: ["0001840317"],
    environment: {},
  });
  assert.equal(missing.status, "failed");
  assert.equal(missing.failures[0]?.stage, "configuration");

  const connection = await runSecPeriodicOsTriggerBridge({
    ciks: ["0001840317"],
    environment: { SEC_USER_AGENT: "Stock Radar test test@example.com" },
    pool: {
      async connect() {
        throw new Error("database unavailable");
      },
      async end() {},
    },
  });
  assert.equal(connection.status, "failed");
  assert.equal(connection.failures[0]?.stage, "connection");
});

function stored(formType: string, cik: string | number) {
  return {
    ok: true,
    raw_item_id: `raw-${formType}-${cik}`,
    form_type: formType,
    cik,
  };
}

function completedResult(cik: string) {
  return {
    issuerCik: cik,
    status: "COMPLETED" as const,
    counts: {
      submissionsFetched: 1,
      submissionsUpdated: 0,
      companyFactsFetched: 1,
      companyFactsUpdated: 0,
      osCandidatesFound: 0,
      filingContextsRequired: 0,
      filingContextsFetched: 0,
      filingContextCacheHits: 0,
      eligibleObservations: 0,
      persistedObservations: 0,
      duplicates: 0,
      universeSnapshotsEvaluated: 0,
      universeSnapshotsInserted: 0,
      universeSnapshotDuplicates: 0,
      universeSnapshotsIncomplete: 0,
      universeSnapshotsAmbiguous: 0,
    },
    reasonCounts: {},
  };
}

function createPoolFixture() {
  let connectCount = 0;
  let releaseCount = 0;
  const client: ServerPostgresClient = {
    async query<Row extends Record<string, unknown>>() {
      return { rows: [] as Row[], rowCount: 0 };
    },
    release() {
      releaseCount += 1;
    },
  };
  const pool: ServerPostgresPool = {
    async connect() {
      connectCount += 1;
      return client;
    },
    async end() {},
  };
  return {
    pool,
    get connectCount() {
      return connectCount;
    },
    get releaseCount() {
      return releaseCount;
    },
  };
}
