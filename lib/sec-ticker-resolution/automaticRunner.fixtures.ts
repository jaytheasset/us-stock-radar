// Synthetic issuers, symbols, source bodies and human actors only. No DB/network.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildSecCoverObservationPayload } from "../sec-cover-observations/canonical.ts";
import { persistSecCoverObservationsForRawItem } from "../sec-cover-observations/persistence.ts";
import type { SecTickerResolutionRepository } from "./persistence.ts";
type Row = Record<string, unknown>;
export const CIK = "0001854445";
export const claim = 'Effective February 19, 2026, we changed our ticker symbol on Nasdaq from "OLD" to "NEW". The change did not alter other terms of our common stock.';

export function fixture(seq: number, symbol: string, accepted: string, narrative = "", extra = "") {
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

export function memory() {
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
      assert.equal(name, "persist_sec_ticker_resolution");
      const decision = payload.p_decision as Row;
      if (!get("sec_issuers").some(row => row.cik === decision.issuer_cik)) get("sec_issuers").push({cik:decision.issuer_cik});
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
