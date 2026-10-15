import assert from "node:assert/strict";
import test from "node:test";
import { buildSecCoverObservationPayload, SecCoverObservationSourceError } from "./canonical.ts";
import {
  persistSecCoverObservationsForRawItem,
  recordSecCoverObservationPersistenceState,
  secCoverObservationFailureState,
  type SecCoverObservationRepository,
} from "./persistence.ts";

const RAW_ID = "10000000-0000-4000-8000-000000000001";
const ACCESSION = "0001234567-26-000001";
// Synthetic issuer, accession and symbol; no SEC or database access.
function rawItem(html = "<html/>", cik = "1234567", truncated = false) {
  const url = `https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/test.htm`;
  return {
    source_code: "sec_edgar", source_group: "filings", source_unique_id: ACCESSION,
    source_url: url, fetched_at: "2026-10-15T00:00:00Z",
    raw_payload: {
      accession_number: ACCESSION, cik, form_type: "10-Q",
      filing_date: "2026-10-14", accepted_at: "2026-10-14T12:00:00Z",
      primary_document_url: html ? url : null, primary_document_html: html || null,
      primary_document_html_char_count: html.length, primary_document_html_truncated: truncated,
    },
  };
}

function repositoryFor(raw: ReturnType<typeof rawItem>) {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const repository: SecCoverObservationRepository = {
    async select(table, query) {
      assert.equal(table, "raw_items");
      assert.equal(query.id, `eq.${RAW_ID}`);
      return { ok: true, status: 200, data: [structuredClone(raw)] };
    },
    async rpc(name, payload) {
      calls.push({ name, payload });
      if (name === "record_sec_cover_observation_persistence_state") {
        return { ok: true, status: 200, data: null };
      }
      assert.equal(name, "persist_sec_cover_observation_result");
      const result = payload.p_result as Record<string, unknown>;
      if (payload.p_source === null && result.source_state === "available") {
        return { ok: false, status: 400, data: null, error: "SEC cover absent source state is invalid" };
      }
      return { ok: true, status: 200, data: {
        status: "replayed", result_id: result.id,
        observation_count: (payload.p_observations as unknown[]).length,
      } };
    },
  };
  return { repository, calls };
}

test("artifact identity rejection preserves its cause before RPC and reaches the existing failure-state contract", async () => {
  const raw = rawItem("<html/>", "7654321");
  const before = structuredClone(raw);
  const canonical = buildSecCoverObservationPayload(RAW_ID, raw)!;
  assert.equal(canonical.payload.extractionStatus, "identity_mismatch");
  assert.equal(canonical.payload.source.status, "available");
  assert.equal(canonical.sourceRaw, null);
  assert.deepEqual(canonical.observations, []);
  const { repository, calls } = repositoryFor(raw);
  let failure: unknown;
  try { await persistSecCoverObservationsForRawItem({ rawItemId: RAW_ID, rawItem: raw, repository }); }
  catch (error) { failure = error; }
  assert.ok(failure instanceof SecCoverObservationSourceError);
  assert.equal(failure.code, "source_identity_invalid");
  assert.equal(failure.message, canonical.payload.issues[0]!.detail);
  assert.equal(calls.length, 0, "invalid source must not reach persistence RPC");
  const state = secCoverObservationFailureState(failure);
  assert.deepEqual(state, { status: "failed", errorCode: "source_identity_invalid" });
  await recordSecCoverObservationPersistenceState({ rawItemId: RAW_ID, state, repository });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, "record_sec_cover_observation_persistence_state");
  assert.equal((calls[0]!.payload.p_state as Record<string, unknown>).error_code, "source_identity_invalid");
  assert.deepEqual(raw, before);
});

for (const sample of [
  { name: "missing", raw: rawItem(""), status: "source_missing" },
  { name: "truncated", raw: rawItem("<html/>", "1234567", true), status: "source_truncated" },
  { name: "malformed XML", raw: rawItem("<html>"), status: "parse_failed" },
]) {
  test(`${sample.name} still persists its zero-observation diagnostic`, async () => {
    const { repository, calls } = repositoryFor(sample.raw);
    const result = await persistSecCoverObservationsForRawItem({ rawItemId: RAW_ID, rawItem: sample.raw, repository });
    assert.equal(result.status, "available");
    if (result.status !== "available") assert.fail();
    assert.equal(result.extractionStatus, sample.status);
    assert.equal(result.observationCount, 0);
    assert.equal(result.writeStatus, "replayed");
    assert.equal(calls.length, 1);
  });
}

function inline(contextCik: string) {
  return `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2026"><ix:header><ix:resources><xbrli:context id="c1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${contextCik}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-10-14</xbrli:instant></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonNumeric name="dei:Security12bTitle" contextRef="c1">Common Stock</ix:nonNumeric><ix:nonNumeric name="dei:TradingSymbol" contextRef="c1">TEST</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="c1">NASDAQ</ix:nonNumeric></html>`;
}

for (const sample of [
  { cik: "1234567", status: "available", observations: 1 },
  { cik: "7654321", status: "identity_mismatch", observations: 0 },
]) {
  test(`validated artifact with ${sample.status} retains the existing RPC path`, async () => {
    const raw = rawItem(inline(sample.cik));
    const { repository, calls } = repositoryFor(raw);
    const result = await persistSecCoverObservationsForRawItem({ rawItemId: RAW_ID, rawItem: raw, repository });
    assert.equal(result.status, "available");
    if (result.status !== "available") assert.fail();
    assert.equal(result.extractionStatus, sample.status);
    assert.equal(result.observationCount, sample.observations);
    assert.equal(calls.length, 1);
    assert.ok(calls[0]!.payload.p_source);
  });
}
