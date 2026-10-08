import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { buildSecCoverObservationPayload } from "./canonical.ts";
import type { SecCoverObservationRepository } from "./persistence.ts";
import { planStoredRawCoverReplay as plan, applyStoredRawCoverReplay as apply, type StoredRawCoverTarget } from "./storedRawReplay.ts";

type Row = Record<string, unknown>;
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("network forbidden"); };
after(() => { globalThis.fetch = originalFetch; assert.equal(networkCalls, 0); });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture(index = 1) {
  const id = `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const accession = `0001234567-26-${String(index).padStart(6, "0")}`;
  const cik = "0001234567";
  const html = `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2026"><body><ix:header><ix:resources><xbrli:context id="cover"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${cik}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-10-01</xbrli:instant></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonNumeric name="dei:Security12bTitle" contextRef="cover">Class B Common Stock</ix:nonNumeric><ix:nonNumeric name="dei:TradingSymbol" contextRef="cover">SYN${index}</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="cover">Synthetic Exchange</ix:nonNumeric></body></html>`;
  const raw: Row = { id, source_code: "sec_edgar", source_group: "filings", source_unique_id: accession,
    fetched_at: "2026-10-08T00:00:00Z", metadata: { untouched: true },
    raw_payload: { accession_number: accession, cik, form_type: "8-K", filing_date: "2026-10-01", accepted_at: "2026-10-01T12:00:00Z", parser_version: "sec_edgar_raw_parser_v1",
      primary_document_html: html, primary_document_sha256: hash(html), primary_document_html_char_count: html.length, primary_document_html_truncated: false,
      primary_document_url: `https://www.sec.gov/Archives/edgar/data/1234567/${accession.replaceAll("-", "")}/source.htm` } };
  const target: StoredRawCoverTarget = { rawItemId: id, accessionNumber: accession, issuerCik: cik, sourceSha256: hash(html) };
  return { raw, target, built: buildSecCoverObservationPayload(id, raw)! };
}
function memory(count = 1) {
  const fixtures = Array.from({ length: count }, (_, n) => fixture(n + 1));
  const tables: Record<string, Row[]> = { raw_items: fixtures.map(f => structuredClone(f.raw)), sec_structured_raw_sources: [], sec_cover_observation_results: [], sec_cover_security_observations: [] };
  const calls: Array<{ kind: string; name: string }> = [];
  let rpcFailure = 0, rpcCount = 0;
  let responseInvalid = false, omitObservations = false;
  let readMode: "ok" | "failed" | "malformed" | "throw" = "ok";
  const repository: SecCoverObservationRepository = {
    async select(table, query) {
      calls.push({ kind: "select", name: table });
      if (readMode === "throw") throw new Error("private provider details");
      if (readMode === "failed") return { ok: false, status: 503, data: null, error: "private provider details" };
      if (readMode === "malformed") return { ok: true, status: 200, data: { bad: true } };
      assert.ok(Object.hasOwn(tables, table));
      const rows = tables[table]!.filter(row => Object.entries(query).every(([key, value]) => !value.startsWith("eq.") || String(row[key]) === value.slice(3)));
      return { ok: true, status: 200, data: structuredClone(rows.slice(0, Number(query.limit ?? 1000))) };
    },
    async rpc(name, value) {
      calls.push({ kind: "rpc", name }); rpcCount++;
      assert.equal(name, "persist_sec_cover_observation_result");
      if (rpcFailure === rpcCount) return { ok: false, status: 503, data: null, error: "credential must not escape" };
      const result = value.p_result as Row, source = value.p_source as Row, observations = value.p_observations as Row[];
      const exists = tables.sec_cover_observation_results.some(row => row.id === result.id);
      if (!exists) {
        tables.sec_structured_raw_sources.push(structuredClone(source));
        tables.sec_cover_observation_results.push(structuredClone(result));
        if (!omitObservations) tables.sec_cover_security_observations.push(...structuredClone(observations));
      }
      return { ok: true, status: 200, data: responseInvalid ? { status: "inserted", result_id: "wrong", observation_count: 0 }
        : { status: exists ? "replayed" : "inserted", result_id: result.id, observation_count: observations.length } };
    },
  };
  return { fixtures, tables, calls, repository, input: { targets: fixtures.map(f => f.target), systemIdentifier: "7678429483712069671", repository },
    setReadMode(mode: typeof readMode) { readMode = mode; }, failRpc(n: number) { rpcFailure = n; },
    badResponse() { responseInvalid = true; }, omitObservations() { omitObservations = true; },
    seed(index = 0) { const b = fixtures[index]!.built; tables.sec_cover_observation_results.push(structuredClone(b.result)); tables.sec_structured_raw_sources.push(structuredClone(b.sourceRaw!)); tables.sec_cover_security_observations.push(...structuredClone(b.observations)); } };
}
test("exact stored raw creates a deterministic query-only plan and body-free receipt", async () => {
  const m = memory(); const before = structuredClone(m.tables);
  const one = await plan(m.input), two = await plan(m.input);
  assert.deepEqual(one, two); assert.equal(one.status, "ready"); assert.equal(one.items[0]!.action, "insert");
  assert.equal(one.items[0]!.observationCount, 1); assert.equal(one.items[0]!.contexts[0]!.tradingSymbol.rawLexicalValue, "SYN1");
  assert.equal(one.items[0]!.resultId, m.fixtures[0]!.built.resultId);
  assert.equal(one.items[0]!.resultPayloadHash, m.fixtures[0]!.built.payloadSha256);
  assert.equal(m.calls.filter(c => c.kind === "rpc").length, 0); assert.deepEqual(m.tables, before);
  const receipt = JSON.stringify(one);
  assert.ok(!receipt.includes("<html") && !receipt.includes("primary_document_html") && !receipt.includes("credential"));
  assert.notEqual((await plan({ ...m.input, systemIdentifier: "1" })).digest, one.digest);
});
test("missing raw differs from failed, thrown and malformed repository reads", async () => {
  const m = memory(); m.tables.raw_items.length = 0;
  assert.equal((await plan(m.input)).items[0]!.reason, "raw_not_found");
  for (const mode of ["failed", "throw", "malformed"] as const) {
    m.setReadMode(mode); const p = await plan(m.input);
    assert.equal(p.items[0]!.action, "unavailable"); assert.notEqual(p.items[0]!.reason, "raw_not_found");
  }
});
for (const mismatch of ["accession", "cik", "expected_sha", "bytes"] as const) {
  test(`blocks ${mismatch} mismatch without RPC`, async () => {
    const m = memory();
    if (mismatch === "accession") m.input.targets[0] = { ...m.input.targets[0]!, accessionNumber: "0001234567-26-999999" };
    if (mismatch === "cik") m.input.targets[0] = { ...m.input.targets[0]!, issuerCik: "0009999999" };
    if (mismatch === "expected_sha") m.input.targets[0] = { ...m.input.targets[0]!, sourceSha256: "f".repeat(64) };
    if (mismatch === "bytes") (m.tables.raw_items[0]!.raw_payload as Row).primary_document_html += "changed";
    const p = await plan(m.input); assert.equal(p.items[0]!.action, "conflict");
    await assert.rejects(apply({ ...m.input, confirmedPlanDigest: p.digest }), /plan_not_ready/);
    assert.equal(m.calls.filter(c => c.kind === "rpc").length, 0);
  });
}
test("digest mismatch and post-plan raw metadata changes block all RPCs", async () => {
  const m = memory(); const p = await plan(m.input);
  await assert.rejects(apply({ ...m.input, confirmedPlanDigest: "f".repeat(64) }), /plan_digest_mismatch/);
  m.tables.raw_items[0]!.metadata = { changed: true };
  await assert.rejects(apply({ ...m.input, confirmedPlanDigest: p.digest }), /plan_digest_mismatch/);
  assert.equal(m.calls.filter(c => c.kind === "rpc").length, 0);
});
test("exact complete stored cover is replay, not mere result-ID existence", async () => {
  const m = memory(); const initial = await plan(m.input); m.seed();
  const replay = await plan(m.input); assert.equal(replay.items[0]!.action, "replay"); assert.equal(replay.digest, initial.digest);
  delete m.tables.sec_cover_observation_results[0]!.filing_ledger_source_raw_id;
  assert.equal((await plan(m.input)).items[0]!.action, "conflict");
  m.tables.sec_cover_observation_results[0]!.filing_ledger_source_raw_id = null;
  for (const table of ["sec_structured_raw_sources", "sec_cover_security_observations"]) {
    const previous = m.tables[table]; m.tables[table] = [];
    assert.equal((await plan(m.input)).items[0]!.action, "conflict"); m.tables[table] = previous!;
  }
  m.tables.sec_cover_observation_results[0]!.result_payload = { other: true };
  assert.equal((await plan(m.input)).items[0]!.action, "conflict");
});
test("conflicting source or observation fields cannot pass replay", async () => {
  for (const table of ["sec_structured_raw_sources", "sec_cover_security_observations"]) {
    const m = memory(); m.seed();
    if (table === "sec_structured_raw_sources") m.tables[table]![0]!.raw_content = "changed";
    else m.tables[table]![0]!.trading_symbol_raw = "OTHER";
    assert.equal((await plan(m.input)).items[0]!.action, "conflict");
  }
});
test("apply validates response and exact reader, then repeats safely with original digest", async () => {
  const m = memory(); const originalRaw = structuredClone(m.tables.raw_items); const p = await plan(m.input);
  const a = await apply({ ...m.input, confirmedPlanDigest: p.digest });
  assert.equal(a.status, "complete"); assert.equal(a.items[0]!.writeStatus, "inserted");
  const snapshot = structuredClone(m.tables);
  const b = await apply({ ...m.input, confirmedPlanDigest: p.digest });
  assert.equal(b.items[0]!.writeStatus, "replayed"); assert.deepEqual(m.tables, snapshot);
  assert.deepEqual(m.tables.raw_items, originalRaw);
  assert.ok(m.calls.filter(c => c.kind === "rpc").every(c => c.name === "persist_sec_cover_observation_result"));
});
test("malformed apply success and incomplete post-apply rows are failed-unconfirmed, never false success", async () => {
  for (const failure of ["response", "readback"]) {
    const m = memory(); const p = await plan(m.input);
    if (failure === "response") m.badResponse(); else m.omitObservations();
    const a = await apply({ ...m.input, confirmedPlanDigest: p.digest });
    assert.equal(a.status, "incomplete"); assert.equal(a.items[0]!.status, "failed_unconfirmed"); assert.equal(a.items[0]!.rpcAttempted, true);
  }
});
test("partial failure reports earlier commits and unattempted suffix; original confirmation safely resumes", async () => {
  const m = memory(3); const p = await plan(m.input); m.failRpc(2);
  const a = await apply({ ...m.input, confirmedPlanDigest: p.digest });
  assert.deepEqual(a.items.map(i => i.status), ["verified", "failed_unconfirmed", "not_attempted"]);
  assert.equal(a.atomicity, "one_raw_item"); assert.equal(m.tables.sec_cover_observation_results.length, 1);
  const resumed = await apply({ ...m.input, confirmedPlanDigest: p.digest });
  assert.deepEqual(resumed.items.map(i => i.writeStatus), ["replayed", "inserted", "inserted"]);
  assert.equal(m.tables.sec_cover_observation_results.length, 3);
});
test("raw drift in persistence's last reread is rejected before RPC", async () => {
  const m = memory(); const p = await plan(m.input); let rawReads = 0;
  const repository: SecCoverObservationRepository = { ...m.repository, async select(table, query) {
    if (table === "raw_items" && ++rawReads === 2) m.tables.raw_items[0]!.metadata = { changedLate: true };
    return m.repository.select(table, query);
  } };
  const a = await apply({ ...m.input, repository, confirmedPlanDigest: p.digest });
  assert.equal(a.items[0]!.status, "failed_unconfirmed"); assert.equal(a.items[0]!.rpcAttempted, false);
});
test("runner imports no ingest orchestration, metadata-state writer or ticker trigger", () => {
  const source = fs.readFileSync(new URL("./storedRawReplay.ts", import.meta.url), "utf8");
  for (const forbidden of ["runSecRawIngest", "persistSecCoverObservationsAfterRawSave", "recordSecCoverObservationPersistenceState", "runSecTickerResolutionAutomaticTrigger"]) assert.ok(!source.includes(forbidden));
});
