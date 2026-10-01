import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { runForm25DelistingAutomaticTrigger as trigger } from "./automaticTrigger.ts";
import { readStoredDelistingState, type DelistingRepository } from "./reader.ts";

const rawId = "25000000-0000-4000-8000-000000000001";
const accession = "0001354457-25-000637";
const url = `https://www.sec.gov/Archives/edgar/data/1492674/${accession.replaceAll("-", "")}/primary_doc.xml`;
const asOf = "2026-09-14";
const request = { rawItemId: rawId, accession, asOf };
// Synthetic adapter contracts; actual source-byte DB runs are recorded separately.
function fixture() {
  const xml = "<notificationOfRemoval><exchange><cik>1354457</cik><entityName>Nasdaq Stock Market LLC</entityName></exchange><issuer><cik>0001492674</cik><entityName>Example</entityName></issuer><descriptionClassSecurity>Common Stock</descriptionClassSecurity></notificationOfRemoval>";
  return { id: rawId, source_code: "sec_edgar", source_group: "filings", source_unique_id: accession, source_url: url,
    title: "Form 25 synthetic adapter boundary", published_at: "2025-07-10T00:00:00Z", fetched_at: "2026-09-14T00:00:00Z",
    body_text: xml, analysis_text: xml, dedupe_key: `sec:${accession}`, metadata: { analysis_status: "completed", sidecar: "untouched" },
    raw_payload: { form_type: "25-NSE/A", accession_number: accession, cik: "1354457", primary_document_url: url,
      primary_document_html: xml, attachment_texts: [{ url: url.replace("primary_doc.xml", "notice.txt"), type: "EX-99.25",
        text: "The Exchange has determined to remove from listing the security of Example effective at the opening of the trading session on July 21, 2025. The Company security was suspended on February 12, 2025." }] } };
}
function repository(raw = fixture()): DelistingRepository {
  return { select: async (table) => ({ ok: true, status: 200, data: table === "raw_items" ? [raw] : [] }),
    rpc: async () => { throw Error("No analyzer or persistence RPC should run without an event"); } };
}

test("stored XML issuer scope invokes unchanged reader and records compact source provenance", async () => {
  const raw = fixture(); const before = structuredClone(raw);
  const result = await trigger({ ...request, repository: repository(raw) });
  assert.equal(result.status, "completed"); assert.equal(result.result?.listing, "confirmed_exchange_delisting");
  assert.equal(result.result?.trading, "suspended");
  assert.equal(result.result?.scope.issuerCik, "0001492674");
  assert.equal(result.result?.evidence[0]?.filedByCik, "1354457");
  const original = await readStoredDelistingState({ rawItemIds: [rawId], asOf, scope: result.result!.scope, repository: repository(raw) });
  assert.equal(result.result?.evidence[0]?.sourceSha256, original.evidence[0]?.sourceSha256);
  assert.equal(result.result?.coverage, "selected_stored_filing_evidence_only");
  assert.equal(result.result?.evidence[0]?.removalDate, "2025-07-21");
  assert.ok(!JSON.stringify(result).includes("<notificationOfRemoval>"));
  assert.deepEqual(raw, before);
});

test("missing XML cannot borrow issuer from filer/catalog, and source identity mismatch stays closed", async () => {
  const raw = fixture(); raw.raw_payload.primary_document_html = "";
  assert.deepEqual((await trigger({ ...request, repository: repository(raw) })).reasons, ["verified_form25_xml_unavailable"]);
  const wrong = { ...fixture(), source_unique_id: "0001354457-25-999999" };
  assert.equal((await trigger({ ...request, repository: repository(wrong) })).status, "unavailable");
  const unofficial = fixture(); unofficial.source_url = "https://example.test/unverified";
  const sourceFailed = await trigger({ ...request, repository: repository(unofficial) });
  assert.equal(sourceFailed.status, "completed"); assert.equal(sourceFailed.result?.listing, "unresolved");
  assert.ok(sourceFailed.reasons.includes("unverified_sec_source"));
});

test("reader query failures and thrown exceptions remain separate from unavailable source evidence", async () => {
  const broken = repository(); broken.select = async () => ({ ok: false, status: 503, data: null });
  assert.equal((await trigger({ ...request, repository: broken })).status, "failed");
  const eventFailure = repository(); const read = eventFailure.select;
  eventFailure.select = async (table, query) => table === "events" ? { ok: false, status: 503, data: null } : read(table, query);
  assert.deepEqual((await trigger({ ...request, repository: eventFailure })).reasons, ["event_read_failed_or_ambiguous"]);
  broken.select = async () => { throw Error("reader rejected"); };
  assert.equal((await trigger({ ...request, repository: broken })).status, "failed");
});

test("replay and simultaneous reads return identical evidence without mutations", async () => {
  const raw = fixture(); const before = structuredClone(raw); const repo = repository(raw);
  const results = await Promise.all([1, 2, 3].map(() => trigger({ ...request, repository: repo })));
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]); assert.deepEqual(raw, before);
});

registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });
const { runSecRawIngest } = await import("../secIngest.ts");

for (const replay of [false, true]) test(`product ${replay ? "replay" : "new"} ingest records reader outcome and retries without raw/site failure`, async () => {
  const raw = fixture(); const before = structuredClone(raw); const finished: Record<string, unknown>[] = [];
  let fail = true; let saved = replay; const invoked: string[] = [];
  const deps = {
    fetchRawItems: async () => ({ ok: true, status: 200, items: [raw], diagnostics: { documentsRequested: 2, documentsFetched: 2, documentsFailed: 0 } }),
    ensureSource: async () => {}, createSourceRun: async () => "running",
    findExistingRawItem: async () => saved ? raw : null,
    saveRawItem: async () => { saved = true; invoked.push("saved"); return raw; },
    finishSourceRun: async (_id: string, status: string, _started: string, stats: unknown, _error: unknown, metadata: Record<string, unknown>) => { finished.push({ status, stats, metadata }); },
    evaluateForm25Delisting: async (input: Parameters<typeof trigger>[0]) => {
      assert.equal(saved, true); invoked.push("reader");
      if (fail) throw Error("intentional reader exception");
      return trigger({ ...input, repository: repository(raw) });
    },
  };
  const first = await runSecRawIngest({}, deps as never);
  assert.equal(first.ok, true); assert.equal(first.stats?.failed_count, 0); assert.equal(first.stats?.form25_delisting_failed_count, 1);
  assert.equal(finished[0]?.status, "completed");
  assert.equal(((finished[0]?.metadata as Record<string, unknown>).form25_delisting as { status: string }[])[0]?.status, "failed");
  fail = false;
  const retry = await runSecRawIngest({}, deps as never);
  assert.equal(retry.ok, true); assert.equal(retry.stats?.form25_delisting_completed_count, 1);
  const recorded = ((finished[1]?.metadata as Record<string, unknown>).form25_delisting as { status: string; rawItemId: string }[])[0];
  assert.equal(recorded?.status, "completed"); assert.equal(recorded?.rawItemId, rawId);
  assert.deepEqual(raw, before); assert.deepEqual(invoked, replay ? ["reader", "reader"] : ["saved", "reader", "reader"]);
});

test("dry run and non-Form25 filings do not call the delisting adapter", async () => {
  let calls = 0;
  const raw = fixture();
  const deps = {
    fetchRawItems: async () => ({ ok: true, status: 200, items: [raw], diagnostics: {} }),
    ensureSource: async () => {}, createSourceRun: async () => "running", findExistingRawItem: async () => raw,
    finishSourceRun: async () => {}, evaluateForm25Delisting: async () => { calls++; throw Error("must not run"); },
    persistCoverObservations: async () => ({ status: "not_applicable" }),
  };
  assert.equal((await runSecRawIngest({ dryRun: true }, deps as never)).ok, true);
  raw.raw_payload.form_type = "8-K";
  // The normal investable gate may exclude a tickerless 8-K before its sidecars.
  assert.equal((await runSecRawIngest({}, deps as never)).ok, true); assert.equal(calls, 0);
});
