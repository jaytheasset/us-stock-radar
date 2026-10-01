import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { persistForm25ListingStatusAutomatically as persist } from "./automaticPersistence.ts";
import { readSecListingHistory } from "./persistence.ts";
import { hash, type Row } from "./observation.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";
import { runSecRawIngest } from "../secIngest.ts";

const rawId = "25000000-0000-4000-8000-000000000001";
const accession = "0001354457-25-000637";
const directory = new URL("../sources/sec/forms/form25/fixtures/source-connection/", import.meta.url);
function fixture(): Row {
  const url = "https://www.sec.gov/Archives/edgar/data/1354457/000135445725000637/primary_doc.xml";
  const xml = readFileSync(new URL("TTOO-4.xml", directory), "utf8");
  return { id: rawId, source_code: "sec_edgar", source_group: "filings", source_unique_id: accession,
    source_url: url, title: "TTOO Form 25", published_at: "2025-07-10T00:00:00Z", fetched_at: "2026-09-30T00:00:00Z",
    body_text: xml, analysis_text: xml, dedupe_key: `sec:${accession}`, metadata: {},
    raw_payload: { form_type: "25-NSE/A", accession_number: accession, primary_document_url: url,
      primary_document_html: xml, attachment_texts: [{ url: url.replace("primary_doc.xml", "ttoodelistreason.txt"),
        text: readFileSync(new URL("TTOO-5.txt", directory), "utf8") }] } };
}
function memory(raw = fixture()) {
  const rows: Row[] = []; let fail = false;
  const repository: SecTickerResolutionRepository = {
    select: async table => ({ ok: true, status: 200, data: table === "raw_items" ? [raw]
      : table === "sec_listing_status_observations" ? rows : [] }),
    rpc: async (name, args) => {
      assert.equal(name, "persist_sec_listing_status_observation");
      if (fail) return { ok: false, status: 500, data: null, error: "injected_storage_failure" };
      const o = args.p_observation as Row; const digest = hash(o); const previous = rows.find(r => r.hash === digest);
      if (previous) return { ok: true, status: 200, data: { status: "replayed", id: previous.id } };
      const id = "25000000-0000-4000-8000-000000000002";
      rows.push({ id, raw_item_id: rawId, observation: o, hash: digest });
      return { ok: true, status: 200, data: { status: "inserted", id } };
    },
  };
  return { raw, rows, repository, fail: (value: boolean) => { fail = value; } };
}
test("retained real evidence becomes a source-time observation, not a filing-date effective claim", async () => {
  const m = memory(); const original = structuredClone(m.raw);
  const first = await persist({ rawItemId: rawId, accession, repository: m.repository });
  assert.equal(first.status, "inserted"); assert.equal(first.evaluatedAsOf, "2025-07-10");
  assert.equal(first.listing, "removal_pending"); assert.equal(first.trading, "suspended");
  assert.equal(first.attachment, "unresolved");
  const history = await readSecListingHistory({ rawItemId: rawId, repository: m.repository });
  assert.ok(history[0].usable); assert.equal(history[0].observation.reported.removalDate, "2025-07-21");
  const repeat = await Promise.all([1, 2].map(() => persist({ rawItemId: rawId, accession, repository: m.repository })));
  assert.ok(repeat.every(r => r.status === "replayed" && r.observationId === first.observationId));
  assert.equal(m.rows.length, 1); assert.deepEqual(m.raw, original);
});
test("missing/tampered source, accession mismatch and non-Form25 cannot create an observation", async () => {
  for (const form of ["8-K", "6-K", "3", "5", "4", "144", "SC 13D"]) {
    const m = memory(); (m.raw.raw_payload as Row).form_type = form;
    assert.equal((await persist({ rawItemId: rawId, accession, repository: m.repository })).status, "not_applicable");
    assert.equal(m.rows.length, 0);
  }
  const m = memory(); (m.raw.raw_payload as Row).primary_document_html = "";
  assert.equal((await persist({ rawItemId: rawId, accession, repository: m.repository })).status, "unavailable");
  assert.equal(m.rows.length, 0);
  assert.equal((await persist({ rawItemId: rawId, accession: "0001354457-25-999999", repository: m.repository })).reason,
    "stored_raw_identity_mismatch");
});

function ingestDependencies(m: ReturnType<typeof memory>, existing: boolean) {
  const finished: Row[] = []; const sequence: string[] = []; let saved = existing;
  const dependencies = {
    fetchRawItems: async () => ({ ok: true, status: 200, items: [m.raw], diagnostics: { documentsRequested: 2, documentsFetched: 2, documentsFailed: 0 } }),
    ensureSource: async () => {}, createSourceRun: async () => "running", findExistingRawItem: async () => saved ? m.raw : null,
    saveRawItem: async () => { saved = true; sequence.push("raw_saved"); return m.raw; },
    finishSourceRun: async (_id: string, status: string, _at: string, stats: unknown, _error: unknown, metadata: unknown) => { finished.push({ status, stats, metadata }); },
    evaluateForm25Identity: async () => ({ status: "unavailable" }),
    evaluateForm25Delisting: async () => ({ status: "unavailable" }),
    persistCoverObservations: async () => { sequence.push("cover_finished"); return { status: "not_applicable" }; },
    persistForm25ListingStatus: async (input: { rawItemId: string; accession: string }) => {
      assert.equal(saved, true); assert.equal(sequence.at(-1), "cover_finished"); sequence.push("listing_persisted");
      return persist({ ...input, repository: m.repository });
    },
  };
  return { dependencies, sequence, finished };
}
for (const existing of [false, true]) test(`normal ${existing ? "existing" : "new"} raw ingest invokes automatic persistence and records outcome`, async () => {
  const m = memory(); const f = ingestDependencies(m, existing);
  const first = await runSecRawIngest({}, f.dependencies as never);
  assert.equal(first.ok, true); assert.equal(first.stats?.form25_listing_observation_inserted_count, 1);
  assert.equal((first.items![0].form25_listing_status as Row).status, "inserted");
  assert.equal(((f.finished[0].metadata as Row).form25_listing_status as Row[])[0].status, "inserted");
  const replay = await runSecRawIngest({}, f.dependencies as never);
  assert.equal(replay.stats?.form25_listing_observation_replayed_count, 1); assert.equal(m.rows.length, 1);
});
test("storage failure is recorded separately, preserves raw success and can recover on the normal rerun", async () => {
  const m = memory(); m.fail(true); const f = ingestDependencies(m, true);
  const first = await runSecRawIngest({}, f.dependencies as never);
  assert.equal(first.ok, true); assert.equal(first.stats?.form25_listing_observation_failed_count, 1);
  assert.equal((first.items![0].form25_listing_status as Row).status, "failed");
  assert.equal(((f.finished[0].metadata as Row).form25_listing_status as Row[])[0].status, "failed");
  assert.equal(m.rows.length, 0); m.fail(false);
  assert.equal((await runSecRawIngest({}, f.dependencies as never)).stats?.form25_listing_observation_inserted_count, 1);
});
test("dry runs and other families do not invoke the automatic persistence hook", async () => {
  const m = memory(); const f = ingestDependencies(m, true);
  await runSecRawIngest({ dryRun: true }, f.dependencies as never);
  assert.equal(m.rows.length, 0); assert.equal(f.sequence.length, 0);
  for (const form of ["8-K", "6-K", "4", "144"]) {
    (m.raw.raw_payload as Row).form_type = form;
    await runSecRawIngest({}, f.dependencies as never);
    assert.ok(!f.sequence.includes("listing_persisted"));
  }
});
