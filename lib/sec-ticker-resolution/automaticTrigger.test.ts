import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { buildSecCoverObservationPayload } from "../sec-cover-observations/canonical.ts";
import { persistSecCoverObservationsForRawItem, recordSecCoverObservationPersistenceState } from "../sec-cover-observations/persistence.ts";
import { runSecTickerResolutionAutomaticTrigger as trigger } from "./automaticTrigger.ts";
import { readSecTickerProductProjectionForTicker } from "./productProjection.ts";
import type { SecTickerResolutionRepository } from "./persistence.ts";

type Row = Record<string, unknown>;
const CIK = "0001854445";
const claim = 'Effective February 19, 2026, we changed our ticker symbol on Nasdaq from "OLD" to "NEW". The change did not alter other terms of our common stock.';

function fixture(seq: number, symbol: string, accepted: string, narrative = "", extra = "") {
  const accession = `0001493152-26-${String(seq).padStart(6, "0")}`;
  const html = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2026"><body><ix:header><ix:resources><xbrli:context id="cover"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${CIK}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonNumeric name="dei:Security12bTitle" contextRef="cover">Common Stock, par value $0.001 per share</ix:nonNumeric><ix:nonNumeric name="dei:TradingSymbol" contextRef="cover">${symbol}</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="cover">Nasdaq</ix:nonNumeric>${extra}<p>${narrative}</p></body></html>`;
  const raw = {
    id: randomUUID(), source_code: "sec_edgar", source_group: "filings", source_unique_id: accession,
    source_url: `https://www.sec.gov/Archives/edgar/data/1854445/${accession.replaceAll("-", "")}/${accession}-index.htm`,
    title: "Synthetic observation boundary", published_at: accepted, fetched_at: "2026-09-14T00:00:00Z",
    body_text: "", analysis_text: "", dedupe_key: `sec:${accession}`, metadata: { existing_sidecar: { status: "completed" } },
    raw_payload: { accession_number: accession, cik: CIK, form_type: "10-Q", filing_date: accepted.slice(0, 10),
      accepted_at: accepted, parser_version: "sec_edgar_raw_parser_v1",
      primary_document_url: `https://www.sec.gov/Archives/edgar/data/1854445/${accession.replaceAll("-", "")}/source.htm`,
      primary_document_html: html, primary_document_html_char_count: html.length, primary_document_html_truncated: false },
  };
  const built = buildSecCoverObservationPayload(raw.id, raw)!;
  assert.ok(built);
  return { raw, built };
}

function memory() {
  const tables = new Map<string, Row[]>();
  const leases = new Map<string, string>();
  const get = (name: string) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
  const add = (name: string, value: Row) => {
    const key = (row: Row) => row.id ?? `${row.result_id}/${row.observation_index}`;
    if (!get(name).some(row => key(row) === key(value))) get(name).push(value);
  };
  const repository: SecTickerResolutionRepository = {
    async select(table, query) {
      let data = get(table).filter(row => Object.entries(query).every(([key, value]) => {
        if (["select", "order", "limit", "offset"].includes(key)) return true;
        if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
        assert.ok(value.startsWith("eq."), value);
        return String(row[key]) === value.slice(3);
      }));
      if (query.order) data = [...data].sort((a, b) => {
        for (const part of query.order.split(",")) {
          const [key, direction] = part.split(".");
          const comparison = String(a[key!] ?? "").localeCompare(String(b[key!] ?? ""));
          if (comparison) return direction === "desc" ? -comparison : comparison;
        }
        return 0;
      });
      return { ok: true, status: 200, data: data.slice(Number(query.offset ?? 0), Number(query.offset ?? 0) + Number(query.limit ?? 1000)) };
    },
    async rpc(name, payload) {
      if (name === "acquire_ingest_workflow_lock") {
        const key = String(payload.p_lock_key); const acquired = !leases.has(key);
        if (acquired) leases.set(key, String(payload.p_lock_owner));
        return { ok: true, status: 200, data: acquired };
      }
      if (name === "renew_ingest_workflow_lock" || name === "release_ingest_workflow_lock") {
        const key = String(payload.p_lock_key); const owned = leases.get(key) === payload.p_lock_owner;
        if (owned && name === "release_ingest_workflow_lock") leases.delete(key);
        return { ok: true, status: 200, data: owned };
      }
      if (name === "persist_sec_cover_observation_result") {
        const result = payload.p_result as Row;
        const replay = get("sec_cover_observation_results").some(row => row.id === result.id);
        if (payload.p_source) add("sec_structured_raw_sources", payload.p_source as Row);
        add("sec_cover_observation_results", result);
        for (const row of payload.p_observations as Row[]) add("sec_cover_security_observations", row);
        return { ok: true, status: 200, data: { status: replay ? "replayed" : "inserted", result_id: result.id, observation_count: (payload.p_observations as Row[]).length } };
      }
      if (name === "record_sec_cover_observation_persistence_state") {
        const raw = get("raw_items").find(row => row.id === payload.p_raw_item_id)!;
        raw.metadata = { ...raw.metadata as Row, sec_cover_observation_persistence: payload.p_state };
        return { ok: true, status: 200, data: null };
      }
      assert.equal(name, "persist_sec_ticker_resolution");
      const decision = payload.p_decision as Row;
      const replay = get("sec_ticker_resolution_decisions").some(row => row.id === decision.id);
      if (payload.p_identity) add("sec_ticker_security_identities", payload.p_identity as Row);
      if (payload.p_evidence) add("sec_ticker_change_evidence", payload.p_evidence as Row);
      add("sec_ticker_resolution_decisions", { ...decision, created_at: "2026-09-14T00:00:00Z" });
      return { ok: true, status: 200, data: { status: replay ? "replayed" : "inserted", decision_id: decision.id, resolution_state: decision.resolution_state } };
    },
  };
  const save = async (f: ReturnType<typeof fixture>) => {
    add("raw_items", f.raw);
    const saved = await persistSecCoverObservationsForRawItem({ rawItemId: f.raw.id, rawItem: f.raw, repository });
    assert.equal(saved.status, "available");
    return saved as Extract<typeof saved, { status: "available" }>;
  };
  return { tables, get, add, repository, save };
}

for (const order of [[0, 1], [1, 0]]) test(`engine AUTO after either arrival order ${order}`, async () => {
  const m = memory(); const fs = [fixture(1, "OLD", "2026-02-17T00:00:00Z"), fixture(2, "NEW", "2026-05-14T00:00:00Z", claim)];
  const initial = await m.save(fs[order[0]!]!);
  assert.equal((await trigger({ ...initial, repository: m.repository })).status, "waiting");
  const final = await m.save(fs[order[1]!]!);
  const result = await trigger({ ...final, repository: m.repository });
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(result.decisions[0]?.resolutionState, "AUTO");
  await Promise.all(Array.from({ length: 4 }, () => trigger({ ...final, repository: m.repository })));
  assert.equal(m.get("sec_ticker_resolution_decisions").length, 1);
  const projected = await readSecTickerProductProjectionForTicker({ ticker: "OLD", repository: m.repository });
  assert.equal(projected.status, "available"); if (projected.status === "available") assert.equal(projected.currentTicker, "NEW");
});

test("later same-symbol retrospective evidence upgrades missing evidence without losing the actual engine UNRESOLVED history", async () => {
  const m = memory(); const old = fixture(10, "OLD", "2026-02-17T00:00:00Z");
  const first = fixture(11, "NEW", "2026-03-14T00:00:00Z");
  await m.save(old); const a = await m.save(first);
  assert.equal((await trigger({ ...a, repository: m.repository })).decisions[0]?.resolutionState, "UNRESOLVED");
  const late = await m.save(fixture(12, "NEW", "2026-05-14T00:00:00Z", claim));
  assert.equal((await trigger({ ...late, repository: m.repository })).decisions[0]?.resolutionState, "AUTO");
  assert.deepEqual(m.get("sec_ticker_resolution_decisions").map(row => row.resolution_state), ["UNRESOLVED", "AUTO"]);
});

test("redundant late filing reuses exact existing request scope instead of a second AUTO edge", async () => {
  const m = memory(); await m.save(fixture(20, "OLD", "2026-02-10T00:00:00Z"));
  const current = await m.save(fixture(22, "NEW", "2026-05-14T00:00:00Z", claim));
  const first = await trigger({ ...current, repository: m.repository });
  const lateOld = await m.save(fixture(21, "OLD", "2026-02-17T00:00:00Z"));
  const replay = await trigger({ ...lateOld, repository: m.repository });
  assert.equal(replay.decisions[0]?.decisionId, first.decisions[0]?.decisionId);
  assert.equal(replay.decisions[0]?.writeStatus, "replayed");
  assert.equal(m.get("sec_ticker_resolution_decisions").length, 1);
});

test("engine REVIEW remains REVIEW, and conflicting independent claims are orchestration review only", async () => {
  const m = memory(); await m.save(fixture(30, "OLD", "2026-02-17T00:00:00Z"));
  const current = await m.save(fixture(31, "NEW", "2026-05-14T00:00:00Z", claim + " This ticker change is part of a reverse merger."));
  assert.equal((await trigger({ ...current, repository: m.repository })).decisions[0]?.resolutionState, "REVIEW");
  const competing = await m.save(fixture(32, "NEW", "2026-06-14T00:00:00Z", claim));
  const result = await trigger({ ...competing, repository: m.repository });
  assert.equal(result.status, "review_required"); assert.equal(result.decisions.length, 0);
  assert.equal(m.get("sec_ticker_resolution_decisions").length, 1);
});

test("multiple common/warrant contexts and missing exchange remain engine REVIEW/UNRESOLVED", async () => {
  const warrant = `<ix:header><ix:resources><xbrli:context id="warrant"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${CIK}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-03-31</xbrli:instant></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonNumeric name="dei:Security12bTitle" contextRef="warrant">Warrants</ix:nonNumeric><ix:nonNumeric name="dei:TradingSymbol" contextRef="warrant">OLDW</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="warrant">Nasdaq</ix:nonNumeric>`;
  const m = memory(); await m.save(fixture(33, "OLD", "2026-02-17T00:00:00Z", "", warrant));
  const input = await m.save(fixture(34, "NEW", "2026-05-14T00:00:00Z", claim));
  const result = await trigger({ ...input, repository: m.repository });
  assert.equal(result.decisions[0]?.resolutionState, "REVIEW");
  assert.equal(m.get("sec_ticker_resolution_decisions")[0]?.security_identity_id, null);
  const missing = memory(); const old = fixture(35, "OLD", "2026-02-17T00:00:00Z");
  old.raw.raw_payload.primary_document_html = old.raw.raw_payload.primary_document_html.replace(/<ix:nonNumeric name="dei:SecurityExchangeName"[^>]*>[^<]*<\/ix:nonNumeric>/, "");
  old.raw.raw_payload.primary_document_html_char_count = old.raw.raw_payload.primary_document_html.length;
  await missing.save(old); const next = await missing.save(fixture(36, "NEW", "2026-05-14T00:00:00Z", claim));
  assert.equal((await trigger({ ...next, repository: missing.repository })).decisions[0]?.resolutionState, "UNRESOLVED");
});

test("reader failure, source mismatch and query bounds do not masquerade as completed", async () => {
  const m = memory(); const input = await m.save(fixture(40, "OLD", "2026-02-17T00:00:00Z"));
  assert.equal((await trigger({ ...input, resultId: randomUUID(), repository: m.repository })).status, "failed");
  const failed = { ...m.repository, select: async () => ({ ok: false, status: 503, data: null }) };
  assert.equal((await trigger({ ...input, repository: failed })).status, "failed");
  const bounded = { ...m.repository, select: async () => ({ ok: true, status: 200, data: Array(101).fill({}) }) };
  assert.deepEqual((await trigger({ ...input, repository: bounded })).reasons, ["issuer_observation_scope_exceeded"]);
});

const source = (value: string) => `data:text/javascript,${encodeURIComponent(value)}`;
registerHooks({ resolve(specifier, context, next) {
  const mocks: Record<string, string> = {
    // FACT's shared request serializer imports this symbol; this cover-only
    // test must still fail if universe skip analysis is actually invoked.
    "@/lib/ai/secInvestableUniverseGate": "export function evaluateSecInvestableUniverse(){return null} export function buildSecInvestableUniverseSkipAnalysis(){throw Error('Unexpected universe skip analysis in cover test')}",
    "@/lib/sources/sec/parser": "export async function fetchSecEdgarRawItems(){throw Error('No external SEC requests')}",
    "@/lib/secStores/rawStore": "export function ensureSecSource(){} export function createSecSourceRun(){} export function finishSecSourceRun(){} export function findExistingSecRawItem(){} export function saveSecRawItem(){}",
    "@/lib/sec-sc13-xml/persistence": "export async function persistSc13CanonicalXmlForRawItem(){return {status:'not_applicable'}} export function recordSc13CanonicalPersistenceState(){} export function sc13PersistenceFailureState(){}",
    "@/lib/monitor/sc13MonitorAutomaticTrigger": "export const SC13_MONITOR_AUTOMATIC_TRIGGER_VERSION='test'; export async function runSc13MonitorAutomaticTrigger(){throw Error('SC13 not in scope')}",
  };
  return mocks[specifier] ? { shortCircuit: true, url: source(mocks[specifier]!) } : next(specifier, context);
} });

for (const replay of [false, true]) test(`product ingest ${replay ? "replay" : "new"} isolates resolution failure and retries; observation state and unrelated metadata survive`, async () => {
  const { runSecRawIngest } = await import("../secIngest.ts");
  const m = memory(); const f = fixture(replay ? 51 : 50, "OLD", "2026-02-17T00:00:00Z");
  await m.save(f); let fail = true; let finished = ""; let calls = 0;
  const dependencies = {
    fetchRawItems: async () => ({ ok: true as const, status: 200, items: [f.raw], diagnostics: {} }),
    ensureSource: async () => undefined, createSourceRun: async () => "running",
    findExistingRawItem: async () => replay ? f.raw : null, saveRawItem: async () => f.raw,
    finishSourceRun: async (_id: string, status: string) => { finished = status; },
    persistCoverObservations: (input: Parameters<typeof persistSecCoverObservationsForRawItem>[0]) => persistSecCoverObservationsForRawItem({ ...input, repository: m.repository }),
    recordCoverState: (input: Parameters<typeof recordSecCoverObservationPersistenceState>[0]) => recordSecCoverObservationPersistenceState({ ...input, repository: m.repository }),
    resolveCoverTickerChange: async (input: Parameters<typeof trigger>[0]) => { calls += 1; if (fail) throw Error("deliberate sidecar failure"); return trigger({ ...input, repository: m.repository }); },
  };
  const first = await runSecRawIngest({}, dependencies as never);
  assert.equal(first.ok, true); assert.equal(finished, "completed");
  const state = () => (m.get("raw_items")[0]!.metadata as Row).sec_cover_observation_persistence as Row;
  assert.equal(state().status, "available"); assert.equal((state().ticker_resolution as Row).status, "failed");
  assert.deepEqual((m.get("raw_items")[0]!.metadata as Row).existing_sidecar, { status: "completed" });
  fail = false; assert.equal((await runSecRawIngest({}, dependencies as never)).ok, true);
  assert.equal((state().ticker_resolution as Row).status, "waiting"); assert.equal(calls, 2);
});

test("existing DB issuer lease blocks the reproduced cross-snapshot pair race; retry keeps one AUTO scope", async () => {
  const m = memory(); const first = fixture(60, "OLD", "2026-02-10T00:00:00Z");
  const later = fixture(61, "OLD", "2026-02-17T00:00:00Z");
  const after = fixture(62, "NEW", "2026-05-14T00:00:00Z", claim);
  await m.save(first); await m.save(later); const input = await m.save(after);
  let entered!: () => void; const atBarrier = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  function snapshot(visible: string[], pause: boolean): SecTickerResolutionRepository { return {
    async select(table, query) {
      const result = { ...await m.repository.select(table, query) };
      if (table === "sec_cover_observation_results") result.data = (result.data as Row[]).filter(row => visible.includes(String(row.accession_number)));
      if (pause && table === "sec_ticker_resolution_decisions" && query.issuer_cik) {
        entered(); await barrier;
      }
      return result;
    }, rpc: m.repository.rpc,
  }; }
  const left = snapshot([first.raw.source_unique_id, after.raw.source_unique_id], true);
  const right = snapshot([first.raw.source_unique_id, later.raw.source_unique_id, after.raw.source_unique_id], false);
  const pending = trigger({ ...input, repository: left }); await atBarrier;
  const busy = await trigger({ ...input, repository: right });
  assert.equal(busy.status, "waiting"); assert.deepEqual(busy.reasons, ["issuer_resolution_busy_retry_on_replay"]);
  release(); const firstResult = await pending;
  const retry = await trigger({ ...input, repository: right });
  assert.equal(firstResult.decisions[0]?.resolutionState, "AUTO");
  assert.equal(retry.decisions[0]?.decisionId, firstResult.decisions[0]?.decisionId);
  assert.equal(m.get("sec_ticker_resolution_decisions").length, 1);
  const projection = await readSecTickerProductProjectionForTicker({ ticker: "OLD", repository: m.repository });
  assert.equal(projection.status, "available");
  if (projection.status === "available") assert.equal(projection.currentTicker, "NEW");
});

test("lost issuer lease prevents persistence and remains retryable", async () => {
  const m = memory(); await m.save(fixture(70, "OLD", "2026-02-17T00:00:00Z"));
  const input = await m.save(fixture(71, "NEW", "2026-05-14T00:00:00Z", claim));
  const repository = { ...m.repository, rpc: async (name: string, value: Row) => name === "renew_ingest_workflow_lock"
    ? { ok: true, status: 200, data: false } : m.repository.rpc(name, value) };
  const result = await trigger({ ...input, repository });
  assert.equal(result.status, "failed"); assert.deepEqual(result.reasons, ["issuer_lease_lost"]);
  assert.equal(m.get("sec_ticker_resolution_decisions").length, 0);
  assert.equal((await trigger({ ...input, repository: m.repository })).decisions[0]?.resolutionState, "AUTO");
});

test("lease loss immediately before persistence writes no decision", async () => {
  const m = memory(); await m.save(fixture(72, "OLD", "2026-02-17T00:00:00Z"));
  const input = await m.save(fixture(73, "NEW", "2026-05-14T00:00:00Z", claim));
  let renewals = 0;
  const repository = { ...m.repository, rpc: async (name: string, value: Row) => {
    if (name === "renew_ingest_workflow_lock" && ++renewals === 3) return { ok: true, status: 200, data: false };
    return m.repository.rpc(name, value);
  } };
  assert.deepEqual((await trigger({ ...input, repository })).reasons, ["issuer_lease_lost"]);
  assert.equal(m.get("sec_ticker_resolution_decisions").length, 0);
});
