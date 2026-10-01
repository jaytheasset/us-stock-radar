import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { buildS8DirectFacts, captureS8Document, hash, stable, S8_SOURCE_VERSION } from "./directFacts.ts";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export{}" };
  return next(specifier, context);
} });
const { readS8Registration, persistS8Registration } = await import("./persistence.ts");
const accession = "0000000001-26-000001";
const url = `https://www.sec.gov/Archives/edgar/data/1/${accession.replaceAll("-", "")}/s8.htm`;
function raw(options: { amount?: string; format?: string; scale?: string; unit?: string; extra?: string; issuer?: string; form?: string } = {}) {
  const text = `<html xmlns:ffd="http://xbrl.sec.gov/ffd/2025"><p>2026 Equity Incentive Plan</p>
  <xbrli:context id="c1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${options.issuer ?? "0000000001"}</xbrli:identifier></xbrli:entity></xbrli:context>
  <xbrli:unit id="shares"><xbrli:measure>${options.unit ?? "xbrli:shares"}</xbrli:measure></xbrli:unit>
  <ix:nonNumeric name="ffd:OfferingSctyTitl" contextRef="c1">Class A Common Stock</ix:nonNumeric>
  <ix:nonNumeric name="ffd:OfferingSctyTp" contextRef="c1">Equity</ix:nonNumeric>
  <ix:nonFraction name="ffd:AmtSctiesRegd" contextRef="c1" unitRef="shares" format="${options.format ?? "ixt:num-dot-decimal"}" scale="${options.scale ?? "0"}">${options.amount ?? "1,234"}</ix:nonFraction>
  ${options.extra ?? ""}</html>`;
  const form = options.form ?? "S-8";
  return { source_code: "sec_edgar", source_unique_id: accession, raw_payload: {
    form_type: form, accession_number: accession, cik: "1", filing_date: "2026-01-02",
    primary_document_url: url, s8_source: { version: S8_SOURCE_VERSION, documents: [captureS8Document(form,
      { url, type: form, description: null, isPrimary: true }, text)!] } } };
}
test("direct class/count/unit and source offsets survive without aggregate/issuance/ratio", () => {
  const source = raw(); const b = buildS8DirectFacts(source); const r = b.facts.registrationRows[0];
  assert.equal(r.amountRegistered?.value, "1234"); assert.equal(r.status, "direct");
  assert.equal(r.canonicalSecurityId, null); assert.equal(r.planRelationships, "unresolved");
  assert.equal(b.facts.planDisclosures[0].text, "2026 Equity Incentive Plan");
  const e = r.amountRegistered!.evidence;
  assert.equal(source.raw_payload.s8_source.documents[0].text.slice(e.start, e.end), e.quote);
  for (const field of ["registeredShares", "additionalShares", "sharesIssued", "dilutionPercent"]) assert.ok(!(field in b.facts));
});
test("older standard dot-decimal format is meaning-preserving", () => {
  assert.equal(buildS8DirectFacts(raw({ format: "ixt:numdotdecimal" })).facts.registrationRows[0].amountRegistered?.value, "1234");
});
test("unsupported units, scales and ambiguous number formats remain unresolved", () => {
  for (const options of [{ unit: "iso4217:USD" }, { scale: "3" }, { amount: "1.234,5" }, { format: "ixt:num-comma-decimal" }]) {
    const row = buildS8DirectFacts(raw(options)).facts.registrationRows[0];
    assert.equal(row.status, "unresolved"); assert.equal(row.amountRegistered?.value, null);
  }
});
test("conflicting context amounts are not selected arbitrarily", () => {
  const b = buildS8DirectFacts(raw({ extra: '<ix:nonFraction name="ffd:AmtSctiesRegd" contextRef="c1">999</ix:nonFraction>' }));
  assert.equal(b.facts.registrationRows[0].amountRegistered, null);
  assert.deepEqual(b.facts.registrationRows[0].reasons, ["amount_conflicting_or_repeated"]);
});
test("another entity's fee context does not become this issuer's registration", () => {
  assert.equal(buildS8DirectFacts(raw({ issuer: "2" })).facts.registrationRows.length, 0);
});
test("S-8/A and S-8 POS retain amendment status; references do not establish a parent", () => {
  for (const form of ["S-8/A", "S-8 POS"]) {
    const b = buildS8DirectFacts(raw({ form, extra: "Prior registration 333-12345" }));
    assert.equal(b.facts.isAmendment, true);
    assert.equal(b.facts.relatedReferences[0].relationship, "unresolved");
  }
});
test("no fee rows means unavailable counts, never narrative maximum or zero", () => {
  const source = raw(); const d = source.raw_payload.s8_source.documents[0];
  d.text = '<p>The plan originally registered 500,000 shares; 8,000,000 shares are outstanding.</p>';
  d.sha256 = hash(d.text); d.charCount = d.text.length;
  const b = buildS8DirectFacts(source);
  assert.deepEqual(b.facts.registrationRows, []);
  assert.ok(b.facts.limitations.includes("no_verified_inline_fee_rows"));
  assert.equal(b.facts.planDisclosures.length, 1);
});
test("source forgery and wrong accession URL fail closed", () => {
  const source = raw(); source.raw_payload.s8_source.documents[0].text += "forged";
  assert.throws(() => buildS8DirectFacts(source), /original_source_invalid/);
  const other = raw(); other.raw_payload.s8_source.documents[0].url = url.replace("26", "25");
  assert.throws(() => buildS8DirectFacts(other), /original_source_invalid/);
});
test("truncated evidence is retained but its facts are not trusted", () => {
  const source = raw(); const d = source.raw_payload.s8_source.documents[0]; d.truncated = true; d.charCount += 10;
  assert.equal(buildS8DirectFacts(source).facts.registrationRows.length, 0);
});
test("official reader revalidates facts even if their stored hash was recomputed", async () => {
  const built = buildS8DirectFacts(raw());
  const saved = { accession_number: accession, issuer_cik: built.facts.issuerCik, form_type: "S-8", raw_item_id: "id",
    sources: built.source, facts: built.facts, source_sha256: built.sourceSha256, facts_sha256: built.factsSha256 };
  const repo = { select: async () => ({ ok: true, data: [saved] }), rpc: async () => ({ ok: true, data: {} }) };
  assert.equal((await readS8Registration(accession, repo)).status, "available");
  saved.facts.registrationRows[0].amountRegistered!.value = "9000"; saved.facts_sha256 = hash(stable(saved.facts));
  assert.equal((await readS8Registration(accession, repo)).status, "unavailable");
});
test("persistence uses stored raw evidence and reports insert vs replay", async () => {
  let n = 0;
  const repo = { select: async () => ({ ok: true, data: [raw()] }), rpc: async (_name: string, args: Record<string, unknown>) => {
    assert.deepEqual(args.p_facts, buildS8DirectFacts(raw()).facts);
    return { ok: true, data: { status: n++ ? "replayed" : "inserted" } };
  } };
  assert.equal((await persistS8Registration({ rawItemId: "id", repository: repo })).writeStatus, "inserted");
  assert.equal((await persistS8Registration({ rawItemId: "id", repository: repo })).writeStatus, "replayed");
});
test("ingest connects both new and existing raw records without analysis or Monitor dependencies", () => {
  const ingest = readFileSync(new URL("../secIngest.ts", import.meta.url), "utf8");
  assert.equal((ingest.match(/s8_registration_persistence: await persistS8AfterRawSave/g) ?? []).length, 2);
  const module = readFileSync(new URL("./persistence.ts", import.meta.url), "utf8");
  assert.doesNotMatch(module, /monitor|gemini|prompt|event_offering_terms|dilution_instruments/i);
});
