import assert from "node:assert/strict";
import test from "node:test";
import { captureS8Document, S8_SOURCE_VERSION, hash, stable } from "./directFacts.ts";
import { buildS8StructuredSource } from "./structuredSource.ts";
import { validateS8Structured, parseS8Structured, S8_STRUCTURED_VERSION, type S8StructuredWire } from "./structuredContract.ts";
import { runS8StructuredAnalyzerPreview, buildS8StructuredPrompt } from "../ai/s8StructuredAnalyzerPreview.ts";
import type { GeminiStructuredJsonRun } from "../ai/geminiStructuredJson.ts";

const accession = "0000000001-26-000001";
const sourceUrl = `https://www.sec.gov/Archives/edgar/data/1/${accession.replaceAll("-", "")}/s8.htm`;
const additional = "This registration statement registers additional Class A Common Stock under the 2026 Equity Incentive Plan, supplementing Registration No. 333-12345.";
function raw(text = additional, withRow = true, form = "S-8") {
  const html = `<html xmlns:ffd="http://xbrl.sec.gov/ffd/2025"><p>${text}</p>
    ${withRow ? `<xbrli:context id="c1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity></xbrli:context>
    <xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>
    <ix:nonNumeric name="ffd:OfferingSctyTitl" contextRef="c1">Class A Common Stock under the 2026 Equity Incentive Plan</ix:nonNumeric>
    <ix:nonFraction name="ffd:AmtSctiesRegd" contextRef="c1" unitRef="shares" format="ixt:num-dot-decimal">1,234</ix:nonFraction>` : ""}</html>`;
  return { source_unique_id: accession, raw_payload: { accession_number: accession, cik: "1",
    form_type: form, filing_date: "2026-01-02", primary_document_url: sourceUrl,
    s8_source: { version: S8_SOURCE_VERSION, documents: [captureS8Document(form, {
      url: sourceUrl, type: form, description: null, isPrimary: true }, html)!] } } };
}
function setup(text = additional, withRow = true, form = "S-8") {
  const r = raw(text, withRow, form), source = buildS8StructuredSource(r);
  const quote = (value: string) => [{ ref: source.evidence.find(e => e.text.includes(value))!.ref, quote: value }];
  const empty = (): S8StructuredWire => ({ version: S8_STRUCTURED_VERSION, source_fingerprint: source.fingerprint,
    filing: { kind: "ambiguous", evidence: [] }, plans: [],
    registrations: source.directRows.map(r => ({ row: r.ref, relation: "unresolved", plan_names: [], evidence: [] })),
    references: [], amendment: { effect: "unresolved", evidence: [] }, unresolved: ["plan_relationship"] });
  return { r, source, quote, empty };
}
test("additional registration snapshot binds existing direct values, never model quantities", () => {
  const { r, source, quote, empty } = setup(); const before = stable(r), value = empty();
  value.filing = { kind: "additional_registration", evidence: quote(additional) };
  value.plans = [{ name: "2026 Equity Incentive Plan", scope: "current_filing", evidence: quote(additional) }];
  value.registrations[0] = { row: "R1", relation: "source_linked", plan_names: ["2026 Equity Incentive Plan"], evidence: quote(additional) };
  value.references = [{ reference: "333-12345", role: "additional_registration_to", evidence: quote(additional) }];
  const result = validateS8Structured(value, source);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.result.directRegistrationRows[0].amountRegistered!.value, "1234");
  assert.equal(stable(result.result.semantic), stable(value));
  assert.equal(stable(r), before);
  assert.equal(result.result.evidence[0].documentUrl, sourceUrl);
});
test("historical reference stays separate; correction cannot promote it to additional registration", () => {
  const text = "This amendment corrects the name of the 2021 Plan. That plan was registered on April 6, 2022.";
  const { source, quote, empty } = setup(text, false, "S-8 POS"); const value = empty();
  value.filing = { kind: "correction", evidence: quote(text) };
  value.amendment = { effect: "corrects_prior", evidence: quote(text) };
  value.references = [{ reference: "April 6, 2022", role: "historical_reference", evidence: quote(text) }];
  assert.equal(validateS8Structured(value, source).ok, true);
  value.references[0].role = "additional_registration_to";
  const result = validateS8Structured(value, source);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.includes("reference:historical_promoted_without_current_addition"));
});
for (const [form, kind, effect, text] of [
  ["S-8/A", "amendment", "updates_exhibits", "This amendment updates Exhibit 5.1 only. No additional securities are registered."],
  ["S-8 POS", "post_effective_deregistration", "deregisters_unsold", "The registrant hereby deregisters all securities remaining unsold under Registration No. 333-12345."],
] as const) test(`${effect}: no current registration is invented`, () => {
  const { source, quote, empty } = setup(text, false, form); const value = empty();
  value.filing = { kind, evidence: quote(text) }; value.amendment = { effect, evidence: quote(text) };
  const good = validateS8Structured(value, source); assert.equal(good.ok, true);
  value.registrations.push({ row: "R1", relation: "unresolved", plan_names: [], evidence: [] });
  assert.equal(validateS8Structured(value, source).ok, false);
});
test("ambiguous plan relationship remains unresolved; incomplete row coverage is rejected", () => {
  const { source, empty } = setup("Two plans are mentioned; no allocation is specified.");
  const value = empty(); assert.equal(validateS8Structured(value, source).ok, true);
  value.registrations[0].plan_names = ["Guessed Plan"];
  assert.equal(validateS8Structured(value, source).ok, false);
  value.registrations = []; assert.equal(validateS8Structured(value, source).ok, false);
});
test("forged refs, wrong-file fingerprint and fabricated quotes fail closed", () => {
  const { source, empty, quote } = setup();
  for (const mutate of [
    (v: S8StructuredWire) => { v.source_fingerprint = "another-filing"; },
    (v: S8StructuredWire) => { v.filing = { kind: "additional_registration", evidence: [{ ref: "E999", quote: additional }] }; },
    (v: S8StructuredWire) => { v.filing = { kind: "additional_registration", evidence: [{ ...quote(additional)[0], quote: "invented" }] }; },
    (v: S8StructuredWire) => { v.filing = { kind: "additional_registration", evidence: [] }; },
  ]) { const v = empty(); mutate(v); assert.equal(validateS8Structured(v, source).ok, false); }
});
for (const key of ["score", "signal", "bullish_points", "bearish_points", "delivery_level", "display_payload", "registered_shares"])
  test(`Primary/quantity field ${key} is forbidden at root and nested assertion`, () => {
    const { source, empty } = setup(); const value = empty();
    assert.equal(validateS8Structured({ ...value, [key]: 1 }, source).ok, false);
    Object.assign(value.filing, { [key]: 1 });
    assert.equal(validateS8Structured(value, source).ok, false);
  });
test("duplicate JSON keys, incomplete JSON, and package tampering are rejected", () => {
  const { source, empty } = setup();
  assert.equal(parseS8Structured('{"version":"a","version":"b"}', source).ok, false);
  assert.equal(parseS8Structured('{"version":', source).ok, false);
  const changed = structuredClone(source); changed.evidence[0].text = "forged";
  assert.equal(validateS8Structured(empty(), changed).ok, false);
});
test("stored source hash mismatch and truncation stop before provider", async () => {
  for (const change of ["hash", "truncated"]) {
    const input = raw(); if (change === "hash") input.raw_payload.s8_source.documents[0].text += "forged";
    else { input.raw_payload.s8_source.documents[0].truncated = true; input.raw_payload.s8_source.documents[0].charCount += 1; }
    let calls = 0;
    const result = await runS8StructuredAnalyzerPreview(input, { runPrompt: async () => { calls++; throw new Error("not allowed"); } });
    assert.equal(result.stage, "input_error"); assert.equal(calls, 0);
  }
});
test("Primary contents cannot influence source package/prompt", () => {
  const { r, source } = setup();
  const polluted = { ...r, primary_analysis: { score: 100, summary: "invented plan" }, ai_output: "wrong" };
  assert.deepEqual(buildS8StructuredSource(polluted), source);
  assert.equal(buildS8StructuredPrompt(source).system.includes("Primary prose"), true);
  assert.ok(!buildS8StructuredPrompt(source).user.includes("invented plan"));
});
test("runtime makes one independent call; invalid output is not repaired or exposed as snapshot", async () => {
  const { r, empty } = setup();
  for (const invalid of [false, true]) {
    let calls = 0;
    const result = await runS8StructuredAnalyzerPreview(r, { model: "test", runPrompt: async args => {
      calls++; assert.equal(args.maxOutputTokens, 4000);
      const output = invalid ? { ...empty(), score: 3 } : empty();
      return { ok: true, responseOk: true, status: 200, statusText: "OK", model: "test", responseId: null,
        outputText: JSON.stringify(output), parsed: output, usage: null,
        body: { candidates: [{ finishReason: "STOP" }] } } as GeminiStructuredJsonRun;
    } });
    assert.equal(calls, 1); assert.equal(result.stage, invalid ? "validation_error" : "complete");
    if (invalid) assert.equal(result.result, null);
  }
});
test("MAX_TOKENS is a provider failure even if a JSON fragment happens to parse", async () => {
  const { r, empty } = setup(); let calls = 0;
  const result = await runS8StructuredAnalyzerPreview(r, { runPrompt: async () => {
    calls++; return { ok: true, responseOk: true, status: 200, statusText: "OK", model: "test", responseId: null,
      outputText: JSON.stringify(empty()), parsed: empty(), usage: null,
      body: { candidates: [{ finishReason: "MAX_TOKENS" }] } } as GeminiStructuredJsonRun;
  } });
  assert.equal(calls, 1); assert.equal(result.stage, "provider_error"); assert.equal(result.result, null);
});
test("direct security title prevents cross-plan substitution when it names the plan", () => {
  const { source, empty, quote } = setup(additional + " The Other Plan is mentioned historically.");
  const value = empty();
  value.plans = [{ name: "2026 Equity Incentive Plan", scope: "current_filing", evidence: quote(additional) },
    { name: "Other Plan", scope: "current_filing", evidence: quote("The Other Plan is mentioned historically.") }];
  value.registrations[0] = { row: "R1", relation: "source_linked", plan_names: ["Other Plan"], evidence: quote("The Other Plan is mentioned historically.") };
  assert.equal(validateS8Structured(value, source).ok, false);
});
