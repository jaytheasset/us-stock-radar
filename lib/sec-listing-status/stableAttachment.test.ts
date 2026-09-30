import assert from "node:assert/strict";
import test from "node:test";
import { buildSecCoverObservationPayload } from "../sec-cover-observations/canonical.ts";
import { readStableIdentityEvidence } from "../sec-ticker-resolution/stableIdentity.ts";
import { resolveListingAttachment } from "./identity.ts";
import { buildObservation, unattached, type Row } from "./observation.ts";
import { readSecListingHistory } from "./persistence.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";

const scope = { issuerCik: "0001321655", securityTitle: "Class A Common Stock", exchange: "New York Stock Exchange" };
// Synthetic inline cover documents exercise the actual parser and validating reader.
function cover(n: number, date: string, ticker = "SAME", form = "10-Q", empty = false) {
  const accession = `0001321655-24-${String(n).padStart(6, "0")}`;
  const url = `https://www.sec.gov/Archives/edgar/data/1321655/000132165524${String(n).padStart(6, "0")}/cover.htm`;
  const html = empty ? "<html>no inline cover</html>" : `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2024"><ix:header><ix:resources><xbrli:context id="c"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${scope.issuerCik}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${date}</xbrli:instant></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonNumeric name="dei:Security12bTitle" contextRef="c">${scope.securityTitle}</ix:nonNumeric><ix:nonNumeric name="dei:TradingSymbol" contextRef="c">${ticker}</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="c">${scope.exchange}</ix:nonNumeric></html>`;
  const rawId = `26000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const raw = { id: rawId, source_code: "sec_edgar", source_group: "filings", source_unique_id: accession,
    source_url: url, published_at: `${date}T00:00:00Z`, fetched_at: `${date}T12:00:00Z`,
    raw_payload: { accession_number: accession, cik: scope.issuerCik, form_type: form, filing_date: date,
      accepted_at: `${date}T00:00:00Z`, parser_version: "sec_edgar_raw_parser_v1", primary_document_url: url,
      primary_document_html: html, primary_document_html_char_count: html.length, primary_document_html_truncated: false } };
  const built = buildSecCoverObservationPayload(rawId, raw); assert.ok(built); return { ...built, raw };
}
async function fixture() {
  const b = cover(1, "2024-08-05"), a = cover(2, "2024-11-04");
  const tables: Record<string, Row[]> = { sec_ticker_resolution_decisions: [], sec_ticker_security_identities: [],
    sec_cover_observation_results: [], sec_cover_security_observations: [], sec_structured_raw_sources: [], raw_items: [],
    sec_listing_status_observations: [] };
  const add = (p: ReturnType<typeof cover>) => { tables.sec_cover_observation_results.push(p.result);
    tables.sec_cover_security_observations.push(...p.observations); if (p.sourceRaw) tables.sec_structured_raw_sources.push(p.sourceRaw);
    tables.raw_items.push(p.raw); };
  add(b); add(a);
  const repository: SecTickerResolutionRepository = { select: async (table, query) => {
    assert.ok(tables[table], table);
    const data = tables[table].filter(row => Object.entries(query).every(([k, v]) => !v.startsWith("eq.") || String(row[k]) === v.slice(3)));
    return { ok: true, status: 200, data: structuredClone(data) };
  }, rpc: async () => { throw Error("read-only check"); } };
  const proof = await readStableIdentityEvidence({ beforeAccession: b.payload.identity.accessionNumber,
    beforeSourceHash: b.payload.source.sha256!, afterAccession: a.payload.identity.accessionNumber,
    afterSourceHash: a.payload.source.sha256! }, repository);
  assert.equal(proof.status, "available");
  tables.sec_ticker_security_identities.push(proof.identity);
  return { tables, repository, add, b, a, proof };
}
test("stable exact attachment uses validated cover sources, with no AUTO decision or backdating", async () => {
  const f = await fixture();
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "attached");
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-08-06")).status, "unresolved");
  assert.equal((await resolveListingAttachment({ ...scope, exchange: "Nasdaq" }, f.repository, "2024-11-25")).status, "unresolved");
  assert.equal(f.tables.sec_ticker_resolution_decisions.length, 0);
});
test("a later known symbol transition requires change evidence; future evidence cannot rewrite the old scope", async () => {
  const f = await fixture(); f.add(cover(3, "2024-11-20", "CHANGED"));
  const blocked = await resolveListingAttachment(scope, f.repository, "2024-11-25");
  assert.equal(blocked.status, "conflict"); assert.match(blocked.reason, /requires_change_evidence/);
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-10")).status, "attached");
});
test("an intervening changed symbol cannot be skipped by selecting two equal endpoints", async () => {
  const f = await fixture(); f.add(cover(3, "2024-09-01", "OTHER"));
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "conflict");
});
test("a source without cover facts is not a conflicting Form 25 cover; unavailable 10-Q identity is blocked", async () => {
  const f = await fixture(); f.add(cover(3, "2024-11-25", "", "25", true));
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "attached");
  f.add(cover(4, "2024-11-24", "", "10-Q", true));
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "conflict");
});
test("conflicting revisions and tampered original source cannot establish identity", async () => {
  const f = await fixture(); const altered = structuredClone(f.a.result); altered.id = "26000000-0000-4000-8000-000000000099";
  altered.source_sha256 = "f".repeat(64);
  f.tables.sec_cover_observation_results.push(altered);
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "conflict");
  const g = await fixture(); g.tables.sec_structured_raw_sources[0].raw_content = "changed";
  assert.notEqual((await resolveListingAttachment(scope, g.repository, "2024-11-25")).status, "attached");
});
test("official history keeps old missing-identity record intact and exposes a separate validated attachment", async () => {
  const f = await fixture(); const raw = cover(3, "2024-11-25", "", "25", true).raw;
  f.tables.raw_items.push(raw);
  const o = buildObservation({ raw, scope, asOf: "2024-11-25", attachment: unattached("no_exact_canonical_security_exchange") });
  f.tables.sec_listing_status_observations.push({ id: raw.id, raw_item_id: raw.id, observation: o });
  const original = structuredClone(o);
  const read = await readSecListingHistory({ rawItemId: raw.id, repository: f.repository });
  assert.equal(read[0].usable, true); assert.equal(read[0].resolvedAttachment?.status, "attached");
  assert.deepEqual(read[0].observation, original); assert.deepEqual(o, original);
  o.attachment = unattached("multiple_security_identities", "conflict");
  assert.equal((await readSecListingHistory({ rawItemId: raw.id, repository: f.repository }))[0].resolvedAttachment, undefined);
});
