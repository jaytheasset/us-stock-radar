// Owned temporary native PostgreSQL only. No Docker, shared DB, SEC network, or candidate derivation.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = process.cwd();
const [bin, archive, output] = process.argv.slice(2);
assert.ok(bin && archive && output, "Usage: <native pg bin> <verified SEC archive> <receipt directory>");
const pg = createRequire(import.meta.url)("pg");
const read = (file) => fs.readFileSync(file, "utf8");
const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");
fs.mkdirSync(output, { recursive: true });
const data = path.resolve(output, `owned-pg-${randomUUID()}`);
const ownerMarker = `${data}.owner`;
const marker = randomUUID();
fs.mkdirSync(data);
fs.writeFileSync(ownerMarker, marker);
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    server.close(() => resolve(address.port));
  });
});
assert.ok(port > 3110);
const report = {
  mode: "owned temporary native PostgreSQL cluster",
  base: "fd2aee264e95ecd8b80fa5108a6fffb2f7a84fa8",
  checks: [],
  networkCalls: 0,
  cleanup: false,
  archive: { manifestSha256: null, bundleSha256: null, accessions: [] },
};
const check = (name, value = true) => {
  assert.ok(value, name);
  report.checks.push(name);
  console.log("PASS", name);
};
globalThis.fetch = async () => {
  report.networkCalls += 1;
  throw new Error("Network is forbidden in offline import verification");
};
const clients = [];
let started = false;
function command(name, args) {
  const result = spawnSync(path.join(bin, `${name}.exe`), args, {
    encoding: "utf8",
    windowsHide: true,
    stdio: name === "pg_ctl" ? "ignore" : "pipe",
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(`${name}: ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}
async function connect(role = "postgres") {
  const client = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  clients.push(client);
  await client.connect();
  const actual = (await client.query("show data_directory")).rows[0].data_directory.replaceAll("\\", "/");
  assert.equal(actual, data.replaceAll("\\", "/"));
  if (role !== "postgres") {
    assert.ok(["service_role", "anon", "authenticated"].includes(role));
    await client.query(`set role ${role}`);
  }
  return client;
}
function rpcArgs(bundle, items = bundle.items, runId = bundle.runId) {
  return [
    runId,
    bundle.manifestSha256,
    bundle.bundleSha256,
    "2026-10-08T13:00:00Z",
    JSON.stringify(items.map((item) => ({
      sourceSha256: item.sourceSha256,
      sourceUtf8ByteCount: item.sourceUtf8ByteCount,
      rawItem: item.rawItem,
    }))),
  ];
}
async function callImport(client, args) {
  const result = await client.query(
    "select public.import_sec_offline_archive_raw($1,$2,$3,$4,$5::jsonb) value",
    args,
  );
  return result.rows[0].value;
}
function clone(value) {
  return structuredClone(value);
}
function moveAccession(item, accession, rawItemId) {
  const next = clone(item);
  const oldNoDashes = next.accessionNumber.replaceAll("-", "");
  const noDashes = accession.replaceAll("-", "");
  next.accessionNumber = accession;
  next.rawItemId = rawItemId;
  next.rawItem.id = rawItemId;
  next.rawItem.source_unique_id = accession;
  next.rawItem.dedupe_key = `sec_edgar:${accession}`;
  next.rawItem.source_url = next.rawItem.source_url.replaceAll(oldNoDashes, noDashes).replace(next.rawItem.raw_payload.accession_number, accession);
  next.rawItem.raw_payload.accession_number = accession;
  next.rawItem.raw_payload.accession_no_dashes = noDashes;
  next.rawItem.raw_payload.detail_url = next.rawItem.source_url;
  next.rawItem.raw_payload.primary_document_url = next.rawItem.raw_payload.primary_document_url.replaceAll(oldNoDashes, noDashes);
  next.rawItem.metadata.accession_number = accession;
  next.rawItem.metadata.primary_document_url = next.rawItem.raw_payload.primary_document_url;
  return next;
}

try {
  command("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "--no-locale", "-E", "UTF8"]);
  command("pg_ctl", ["-D", data, "-l", path.resolve(output, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "start"]);
  started = true;
  const admin = await connect();
  await admin.query(`
    create role service_role nologin bypassrls;
    create role anon nologin;
    create role authenticated nologin;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create type public.run_status as enum ('queued','running','completed','failed','skipped');
    create type public.runtime_owner as enum ('render','nas','external','manual');
    create type public.source_group as enum ('news','filings','market');
    create table public.sources(
      code text primary key,name text not null,source_group public.source_group not null,
      runtime_owner public.runtime_owner not null,enabled boolean not null default true,
      poll_interval_seconds integer,metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now()
    );
    create table public.source_runs(
      id uuid primary key,source_code text not null,source_group public.source_group not null,
      run_type text not null,status public.run_status not null,started_at timestamptz not null default now(),
      finished_at timestamptz,stats jsonb not null default '{}'::jsonb,error_message text,
      metadata jsonb not null default '{}'::jsonb
    );
    create table public.raw_items(
      id uuid primary key,run_id uuid references public.source_runs(id),source_code text not null,
      source_group public.source_group not null,source_unique_id text,source_url text,title text,
      published_at timestamptz,fetched_at timestamptz not null default now(),body_text text,
      analysis_text text,raw_payload jsonb not null default '{}'::jsonb,
      metadata jsonb not null default '{}'::jsonb,dedupe_key text
    );
    create unique index raw_items_source_unique_idx on public.raw_items(source_code,source_unique_id)
      where source_unique_id is not null;
    grant usage on schema public,extensions to service_role,anon,authenticated;
    grant select,insert on public.sources,public.source_runs,public.raw_items to service_role;
  `);
  const migrationFile = "supabase/migrations/20261008134000_sec_offline_archive_raw_import.sql";
  const migration = read(migrationFile);
  await admin.query(migration);
  report.migration = { file: migrationFile, sha256: sha(migration) };
  check("migration applies to owned PostgreSQL with existing raw/source tables only");

  const { buildSecOfflineArchiveImportBundle } = await import("../lib/sec-offline-import/canonical.ts");
  const bundle = await buildSecOfflineArchiveImportBundle({ directory: archive });
  report.archive = {
    manifestSha256: bundle.manifestSha256,
    bundleSha256: bundle.bundleSha256,
    accessions: bundle.items.map((item) => item.accessionNumber),
  };
  assert.deepEqual(report.archive.accessions, ["0001104659-26-113076", "0001104659-26-113913"]);
  check("retained PSKY before/after originals pass exact manifest, Submissions, UTF-8, and SHA checks");

  const service = await connect("service_role");
  const inserted = await callImport(service, rpcArgs(bundle));
  assert.equal(inserted.status, "inserted");
  assert.equal(inserted.inserted_count, 2);
  assert.equal(inserted.replayed_count, 0);
  assert.deepEqual(inserted.items.map((item) => item.accession_number), [...report.archive.accessions].sort());
  const counts = async () => (await admin.query(`
    select
      (select count(*)::int from public.sources) sources,
      (select count(*)::int from public.source_runs) runs,
      (select count(*)::int from public.raw_items) raws
  `)).rows[0];
  assert.deepEqual(await counts(), { sources: 1, runs: 1, raws: 2 });
  check("one atomic apply inserts one source run and two canonical raw_items without downstream rows");

  const stored = (await admin.query(`
    select id,run_id,source_unique_id,source_url,raw_payload,metadata
    from public.raw_items order by source_unique_id
  `)).rows;
  for (let index = 0; index < stored.length; index += 1) {
    const row = stored[index];
    const expected = bundle.items[index];
    assert.equal(row.id, expected.rawItemId);
    assert.equal(row.run_id, bundle.runId);
    assert.equal(row.source_unique_id, expected.accessionNumber);
    assert.equal(row.source_url, expected.rawItem.source_url);
    assert.equal(row.raw_payload.primary_document_sha256, expected.sourceSha256);
    assert.equal(
      createHash("sha256").update(row.raw_payload.primary_document_html, "utf8").digest("hex"),
      expected.sourceSha256,
    );
    assert.equal(row.raw_payload.offline_archive_import.acquisitionMethod, "offline_archive");
    assert.equal(row.raw_payload.offline_archive_import.bundleSha256, bundle.bundleSha256);
    assert.equal(row.raw_payload.ticker, null);
    assert.equal(row.metadata.offline_archive_import.sourceSha256, expected.sourceSha256);
  }
  check("stored raw bodies, deterministic IDs, source URLs, SHA lineage, and unresolved ticker meaning round-trip exactly");

  const replayed = await callImport(service, rpcArgs(bundle));
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.inserted_count, 0);
  assert.equal(replayed.replayed_count, 2);
  assert.deepEqual(await counts(), { sources: 1, runs: 1, raws: 2 });
  check("same manifest and same bytes replay with zero duplicate raw or source-run writes");

  const productionReplay = moveAccession(bundle.items[0], "0001104659-26-999000", randomUUID());
  const existingProduction = clone(productionReplay.rawItem);
  existingProduction.id = randomUUID();
  existingProduction.raw_payload.accepted_at = "2026-10-02 17:29:01+00";
  delete existingProduction.raw_payload.offline_archive_import;
  existingProduction.metadata = { acquisitionMethod: "network" };
  await service.query("begin");
  try {
    await service.query(`
      insert into public.raw_items(
        id,run_id,source_code,source_group,source_unique_id,source_url,title,
        published_at,fetched_at,body_text,analysis_text,raw_payload,metadata,dedupe_key
      ) values($1,null,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      existingProduction.id,
      existingProduction.source_code,
      existingProduction.source_group,
      existingProduction.source_unique_id,
      existingProduction.source_url,
      existingProduction.title,
      existingProduction.published_at,
      existingProduction.fetched_at,
      existingProduction.body_text,
      existingProduction.analysis_text,
      JSON.stringify(existingProduction.raw_payload),
      JSON.stringify(existingProduction.metadata),
      existingProduction.dedupe_key,
    ]);
    const networkReplay = await callImport(
      service,
      rpcArgs(bundle, [productionReplay], randomUUID()),
    );
    assert.equal(networkReplay.status, "replayed");
    assert.equal(networkReplay.inserted_count, 0);
    assert.equal(networkReplay.replayed_count, 1);
    assert.equal(networkReplay.items[0].raw_item_id, existingProduction.id);
    assert.equal(
      (await service.query(
        "select count(*)::int count from public.raw_items where source_unique_id=$1",
        [productionReplay.accessionNumber],
      )).rows[0].count,
      1,
    );
  } finally {
    await service.query("rollback");
  }
  assert.deepEqual(await counts(), { sources: 1, runs: 1, raws: 2 });
  check("an exact pre-existing network raw replays without importer provenance; equivalent timestamp formatting is accepted");

  const drift = clone(bundle.items);
  const changedHtml = `${drift[0].rawItem.raw_payload.primary_document_html}<!--changed-->`;
  const changedSha = createHash("sha256").update(changedHtml, "utf8").digest("hex");
  drift[0].rawItem.id = randomUUID();
  drift[0].rawItemId = drift[0].rawItem.id;
  drift[0].sourceSha256 = changedSha;
  drift[0].sourceUtf8ByteCount = Buffer.byteLength(changedHtml, "utf8");
  drift[0].rawItem.raw_payload.primary_document_html = changedHtml;
  drift[0].rawItem.raw_payload.primary_document_html_char_count = changedHtml.length;
  drift[0].rawItem.raw_payload.primary_document_html_utf8_byte_count = drift[0].sourceUtf8ByteCount;
  drift[0].rawItem.raw_payload.primary_document_sha256 = changedSha;
  drift[0].rawItem.raw_payload.offline_archive_import.sourceSha256 = changedSha;
  drift[0].rawItem.raw_payload.offline_archive_import.sourceUtf8ByteCount = drift[0].sourceUtf8ByteCount;
  drift[0].rawItem.metadata.offline_archive_import.sourceSha256 = changedSha;
  drift[0].rawItem.metadata.offline_archive_import.sourceUtf8ByteCount = drift[0].sourceUtf8ByteCount;
  await assert.rejects(
    callImport(service, rpcArgs(bundle, drift, randomUUID())),
    /SEC_OFFLINE_ARCHIVE_RAW_CONFLICT/,
  );
  assert.deepEqual(await counts(), { sources: 1, runs: 1, raws: 2 });
  check("same accession with different internally valid bytes aborts the entire batch and preserves existing raw");

  const newFirst = moveAccession(bundle.items[0], "0001104659-26-999001", randomUUID());
  const invalidSecond = moveAccession(bundle.items[1], "0001104659-26-999002", randomUUID());
  invalidSecond.sourceSha256 = "f".repeat(64);
  const atomicRun = randomUUID();
  await assert.rejects(
    callImport(service, rpcArgs(bundle, [newFirst, invalidSecond], atomicRun)),
    /SEC_OFFLINE_ARCHIVE_INPUT_INVALID/,
  );
  assert.deepEqual(await counts(), { sources: 1, runs: 1, raws: 2 });
  assert.equal((await admin.query("select count(*)::int count from public.source_runs where id=$1", [atomicRun])).rows[0].count, 0);
  check("a later invalid item rolls back the full batch with no raw or run residue");

  for (const role of ["anon", "authenticated"]) {
    const client = await connect(role);
    await assert.rejects(
      client.query("select public.import_sec_offline_archive_raw(null,null,null,null,null)"),
      (error) => error.code === "42501",
    );
    await assert.rejects(client.query("select * from public.raw_items"), (error) => error.code === "42501");
    check(`${role} cannot execute import RPC or read raw source rows`);
  }

  const functions = (await admin.query(`
    select routine_name from information_schema.routines
    where routine_schema='public' and routine_name='import_sec_offline_archive_raw'
  `)).rows;
  assert.equal(functions.length, 1);
  assert.equal(report.networkCalls, 0);
  check("verification used no SEC/network call and created no candidate, human judgment, comparison, audit, or ticker authority path");
  report.pass = true;
} catch (error) {
  report.pass = false;
  report.error = error instanceof Error ? error.stack : String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.end().catch(() => undefined);
  if (started || fs.existsSync(path.join(data, "postmaster.pid"))) {
    command("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  }
  assert.equal(fs.readFileSync(ownerMarker, "utf8"), marker);
  assert.ok(data.startsWith(path.resolve(output) + path.sep));
  fs.rmSync(data, { recursive: true, force: true });
  fs.rmSync(ownerMarker, { force: true });
  report.cleanup = true;
  fs.writeFileSync(path.join(output, "postgres-result.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ pass: report.pass, checks: report.checks.length, cleanup: report.cleanup }));
}
