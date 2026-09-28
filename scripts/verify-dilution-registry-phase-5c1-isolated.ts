import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { createDilutionRegistryPasteIdFromSource } from "../lib/dilution-registry/pasteIdentity.ts";

const { Client } = pg;
const fixturePathFromEnv = process.env.DILUTION_REGISTRY_REFERENCE_FIXTURE;

const connectionString = process.env.DILUTION_REGISTRY_ISOLATED_DB_URL;
const expectedPort = process.env.DILUTION_REGISTRY_ISOLATED_DB_PORT;
if (!connectionString || !expectedPort || !fixturePathFromEnv) {
  throw new Error(
    "DILUTION_REGISTRY_ISOLATED_DB_URL, DILUTION_REGISTRY_ISOLATED_DB_PORT, and DILUTION_REGISTRY_REFERENCE_FIXTURE are required.",
  );
}
const fixturePath = fixturePathFromEnv;

const databaseUrl = new URL(connectionString);
assertIsolatedDatabaseTarget(databaseUrl, expectedPort);

const mode = process.argv.includes("--guard-self-test")
  ? "guard-self-test"
  : process.argv.includes("--concurrency")
    ? "concurrency"
    : "acceptance";
let source: string;
let fixture: Record<string, any>;

async function main() {
  if (mode === "guard-self-test") {
    runGuardSelfTest();
    return;
  }

  source = await readFile(fixturePath, "utf8");
  fixture = JSON.parse(source);

  if (mode === "concurrency") {
    await runConcurrencyAcceptance();
  } else {
    await runFixtureAcceptance();
  }
}

function assertIsolatedDatabaseTarget(databaseUrl: URL, requiredPort: string) {
  assert.ok(
    databaseUrl.hostname === "127.0.0.1" ||
      databaseUrl.hostname === "localhost",
    "isolated acceptance refuses non-loopback databases",
  );
  assert.equal(
    databaseUrl.port,
    requiredPort,
    "isolated database port must match the explicit gate",
  );
  assert.ok(
    !new Set(["54322", "56322"]).has(databaseUrl.port),
    `shared Supabase DB port ${databaseUrl.port} is forbidden`,
  );
}

function runGuardSelfTest() {
  assert.throws(
    () =>
      assertIsolatedDatabaseTarget(
        new URL("postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
        "54322",
      ),
    /shared Supabase DB port 54322 is forbidden/,
  );
  assert.throws(
    () =>
      assertIsolatedDatabaseTarget(
        new URL("postgresql://postgres:postgres@127.0.0.1:56322/postgres"),
        "56322",
      ),
    /shared Supabase DB port 56322 is forbidden/,
  );
  assert.doesNotThrow(() =>
    assertIsolatedDatabaseTarget(
      new URL("postgresql://postgres:postgres@127.0.0.1:55322/postgres"),
      "55322",
    ),
  );
  process.stdout.write(
    `${JSON.stringify({ mode, rejectedPorts: [54322, 56322], acceptedPort: 55322 })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});

async function runFixtureAcceptance() {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const identity = await readDatabaseIdentity(client);
    const baseline = await readCounts(client);
    assert.deepEqual(
      baseline,
      counts(0, 0, 0, 0),
      "fixture acceptance requires a clean database",
    );

    const pasteId = createDilutionRegistryPasteIdFromSource(source);
    const first = await applySource(client, source, pasteId);
    assert.equal(first.already_saved, false);
    assert.deepEqual(first.added, counts(20, 20, 8, 4));

    const firstCounts = await readCounts(client);
    assert.deepEqual(firstCounts, counts(20, 20, 8, 4));

    const second = await applySource(client, source, pasteId);
    assert.equal(second.already_saved, true);
    assert.deepEqual(second.added, counts(0, 0, 0, 0));
    const replayCounts = await readCounts(client);
    assert.deepEqual(replayCounts, firstCounts);

    let serviceRoleReplay: ApplyResult;
    await client.query("set role service_role");
    try {
      serviceRoleReplay = await applySource(client, source, pasteId);
      assert.equal(serviceRoleReplay.already_saved, true);
      assert.deepEqual(serviceRoleReplay.added, counts(0, 0, 0, 0));
    } finally {
      await client.query("reset role");
    }

    const changed = structuredClone(fixture);
    changed.issuer.note = `${changed.issuer.note || ""} changed`;
    const changedSource = JSON.stringify(changed);
    const changedPasteId =
      createDilutionRegistryPasteIdFromSource(changedSource);
    assert.notEqual(changedPasteId, pasteId);

    const totalsEmptyCases = await runTotalsEmptyCases(client);

    const failure = failurePayload();
    const failureSource = JSON.stringify(failure);
    // This deliberately bypasses Preview validation only to exercise the RPC's
    // mid-operation rollback contract with malformed test input.
    const failurePasteId = createRawSourcePasteId(failureSource);
    const beforeFailure = await readCounts(client);
    await assert.rejects(
      () => applySource(client, failureSource, failurePasteId),
      (error: unknown) =>
        isPgError(
          error,
          "23503",
          "activity references a missing instrument_key",
        ),
    );
    const afterFailure = await readCounts(client);
    assert.deepEqual(afterFailure, beforeFailure);
    assert.equal(await markerCount(client, failurePasteId), 0);

    const corrected = structuredClone(failure);
    corrected.activities[0].instrument_key =
      corrected.instruments[0].instrument_key;
    const correctedSource = JSON.stringify(corrected);
    const correctedPasteId =
      createDilutionRegistryPasteIdFromSource(correctedSource);
    assert.notEqual(correctedPasteId, failurePasteId);
    const correctedResult = await applySource(
      client,
      correctedSource,
      correctedPasteId,
    );
    assert.equal(correctedResult.already_saved, false);
    assert.deepEqual(correctedResult.added, counts(1, 1, 1, 0));
    assert.equal(await markerCount(client, correctedPasteId), 1);

    const mismatch = identityMismatchPayload(fixture);
    const mismatchSource = JSON.stringify(mismatch);
    const mismatchPasteId =
      createDilutionRegistryPasteIdFromSource(mismatchSource);
    const beforeMismatch = await readCounts(client);
    await assert.rejects(
      () => applySource(client, mismatchSource, mismatchPasteId),
      (error: unknown) =>
        isPgError(error, "23514", "instrument identity does not match"),
    );
    assert.deepEqual(await readCounts(client), beforeMismatch);
    assert.equal(await markerCount(client, mismatchPasteId), 0);

    process.stdout.write(
      `${JSON.stringify(
        {
          mode,
          fixturePath,
          database: identity,
          pasteId,
          first,
          firstCounts,
          second,
          replayCounts,
          serviceRoleReplay,
          changedPasteId,
          changedIdentityDiffers: changedPasteId !== pasteId,
          totalsEmptyCases,
          failure: {
            pasteId: failurePasteId,
            before: beforeFailure,
            after: afterFailure,
            markerCount: await markerCount(client, failurePasteId),
          },
          corrected: {
            pasteId: correctedPasteId,
            result: correctedResult,
            markerCount: await markerCount(client, correctedPasteId),
          },
          mismatch: {
            pasteId: mismatchPasteId,
            before: beforeMismatch,
            after: await readCounts(client),
            markerCount: await markerCount(client, mismatchPasteId),
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await client.end();
  }
}

async function runTotalsEmptyCases(client: pg.Client) {
  const snapshot = await applyFirstAndReplay(
    client,
    snapshotWithoutTotalsPayload(),
    counts(1, 1, 0, 0),
    1,
  );
  const activity = await applyFirstAndReplay(
    client,
    activityWithoutSnapshotOrTotalsPayload(),
    counts(1, 0, 1, 0),
    1,
  );
  const instrumentOnly = await applyFirstAndReplay(
    client,
    instrumentOnlyPayload(),
    counts(1, 0, 0, 0),
    0,
  );
  const fullyEmpty = await applyFirstAndReplay(
    client,
    fullyEmptyPayload(),
    counts(0, 0, 0, 0),
    0,
    true,
  );

  assert.deepEqual(await readCounts(client), counts(23, 21, 9, 4));
  return { snapshot, activity, instrumentOnly, fullyEmpty };
}

async function applyFirstAndReplay(
  client: pg.Client,
  payload: Record<string, any>,
  expectedAdded: Counts,
  expectedMarkerCount: number,
  firstIsNoOp = false,
) {
  const payloadSource = JSON.stringify(payload);
  const pasteId = createDilutionRegistryPasteIdFromSource(payloadSource);
  const first = await applySource(client, payloadSource, pasteId);
  assert.equal(first.already_saved, firstIsNoOp);
  assert.deepEqual(first.added, expectedAdded);
  assert.equal(await markerCount(client, pasteId), expectedMarkerCount);

  const beforeReplay = await readCounts(client);
  const replay = await applySource(client, payloadSource, pasteId);
  assert.equal(replay.already_saved, true);
  assert.deepEqual(replay.added, counts(0, 0, 0, 0));
  assert.deepEqual(await readCounts(client), beforeReplay);
  assert.equal(await markerCount(client, pasteId), expectedMarkerCount);
  return { pasteId, first, replay, markerCount: expectedMarkerCount };
}

async function runConcurrencyAcceptance() {
  const clientA = new Client({ connectionString });
  const clientB = new Client({ connectionString });
  await Promise.all([clientA.connect(), clientB.connect()]);
  try {
    const identity = await readDatabaseIdentity(clientA);
    assert.deepEqual(await readCounts(clientA), counts(0, 0, 0, 0));
    const payload = concurrencyPayload();
    const concurrentSource = JSON.stringify(payload);
    const pasteId = createDilutionRegistryPasteIdFromSource(concurrentSource);
    const results = await Promise.all([
      applySource(clientA, concurrentSource, pasteId),
      applySource(clientB, concurrentSource, pasteId),
    ]);
    assert.equal(
      results.filter((result) => result.already_saved === false).length,
      1,
    );
    assert.equal(
      results.filter((result) => result.already_saved === true).length,
      1,
    );
    assert.deepEqual(await readCounts(clientA), counts(1, 1, 0, 0));
    assert.equal(await markerCount(clientA, pasteId), 1);
    process.stdout.write(
      `${JSON.stringify(
        {
          mode,
          database: identity,
          pasteId,
          results,
          counts: await readCounts(clientA),
          markerCount: await markerCount(clientA, pasteId),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await Promise.all([clientA.end(), clientB.end()]);
  }
}

async function applySource(client: pg.Client, source: string, pasteId: string) {
  const response = await client.query<{ result: ApplyResult }>(
    "select public.apply_dilution_registry_v1($1::jsonb, $2::text, $3::text) as result",
    [source, pasteId, source],
  );
  return response.rows[0].result;
}

async function readCounts(client: pg.Client): Promise<Counts> {
  const response = await client.query<Counts>(`
    select
      (select count(*)::integer from public.dilution_instruments) as instruments,
      (select count(*)::integer from public.dilution_instrument_snapshots) as snapshots,
      (select count(*)::integer from public.dilution_instrument_activity) as activities,
      (select count(*)::integer from public.dilution_totals) as totals
  `);
  return response.rows[0];
}

async function markerCount(client: pg.Client, pasteId: string) {
  const response = await client.query<{ count: number }>(
    `select count(*)::integer as count
     from (
       select paste_id from public.dilution_instrument_snapshots
       union all
       select paste_id from public.dilution_instrument_activity
       union all
       select paste_id from public.dilution_totals
     ) as markers
     where paste_id = $1`,
    [pasteId],
  );
  return response.rows[0].count;
}

async function readDatabaseIdentity(client: pg.Client) {
  const response = await client.query<{
    server_address: string;
    server_port: number;
    database_name: string;
    data_directory: string;
  }>(`
    select
      pg_catalog.inet_server_addr()::text as server_address,
      pg_catalog.inet_server_port() as server_port,
      pg_catalog.current_database() as database_name,
      pg_catalog.current_setting('data_directory') as data_directory
  `);
  return response.rows[0];
}

function snapshotWithoutTotalsPayload() {
  return {
    issuer: { issuer_cik: "0001840317" },
    instruments: [
      {
        instrument_key: "phase-5c-1-snapshot-no-total",
        instrument_type: "convertible_note",
        name: "Snapshot Without Total",
      },
    ],
    snapshots: [
      {
        instrument_key: "phase-5c-1-snapshot-no-total",
        as_of_date: "2026-08-28",
        status: "current",
      },
    ],
    activities: [],
    totals: [],
  };
}

function activityWithoutSnapshotOrTotalsPayload() {
  return {
    issuer: { issuer_cik: "0001840317" },
    instruments: [
      {
        instrument_key: "phase-5c-1-activity-no-total",
        instrument_type: "convertible_note",
        name: "Activity Without Snapshot Or Total",
      },
    ],
    snapshots: [],
    activities: [
      {
        instrument_key: "phase-5c-1-activity-no-total",
        activity_type: "issued",
      },
    ],
    totals: [],
  };
}

function instrumentOnlyPayload() {
  return {
    issuer: { issuer_cik: "0001840317" },
    instruments: [
      {
        instrument_key: "phase-5c-1-instrument-only",
        instrument_type: "convertible_note",
        name: "Instrument Only",
      },
    ],
    snapshots: [],
    activities: [],
    totals: [],
  };
}

function fullyEmptyPayload() {
  return {
    instruments: [],
    snapshots: [],
    activities: [],
    totals: [],
  };
}

function failurePayload() {
  return {
    issuer: { issuer_cik: "0001840317" },
    instruments: [
      {
        instrument_key: "phase-5c-1-failure-note",
        instrument_type: "convertible_note",
        name: "Phase 5C-1 Failure Note",
      },
    ],
    snapshots: [
      {
        instrument_key: "phase-5c-1-failure-note",
        as_of_date: "2026-08-28",
        status: "current",
      },
    ],
    activities: [
      {
        instrument_key: "phase-5c-1-missing-reference",
        activity_type: "issued",
      },
    ],
    totals: [],
  };
}

function concurrencyPayload() {
  return {
    issuer: { issuer_cik: "0001840317" },
    instruments: [
      {
        instrument_key: "phase-5c-1-concurrent-note",
        instrument_type: "convertible_note",
        name: "Phase 5C-1 Concurrent Note",
      },
    ],
    snapshots: [
      {
        instrument_key: "phase-5c-1-concurrent-note",
        as_of_date: "2026-08-28",
        status: "current",
      },
    ],
    activities: [],
    totals: [],
  };
}

function identityMismatchPayload(payload: Record<string, any>) {
  const first = payload.instruments[0];
  return {
    issuer: payload.issuer,
    instruments: [
      {
        ...first,
        instrument_type:
          first.instrument_type === "warrant" ? "convertible_note" : "warrant",
      },
    ],
    snapshots: [],
    activities: [],
    totals: [
      {
        issuer_cik: payload.issuer.issuer_cik,
        instrument_type: "warrant",
        name: "Phase 5C-1 Identity Mismatch Total",
      },
    ],
  };
}

function counts(
  instruments: number,
  snapshots: number,
  activities: number,
  totals: number,
): Counts {
  return { instruments, snapshots, activities, totals };
}

function createRawSourcePasteId(sourceText: string) {
  return `dilution-registry:v1:${createHash("sha256").update(sourceText, "utf8").digest("hex")}`;
}

function isPgError(error: unknown, code: string, messagePart: string) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code &&
    "message" in error &&
    String((error as { message?: unknown }).message).includes(messagePart),
  );
}

type Counts = {
  instruments: number;
  snapshots: number;
  activities: number;
  totals: number;
};

type ApplyResult = {
  already_saved: boolean;
  paste_id: string;
  added: Counts;
};
