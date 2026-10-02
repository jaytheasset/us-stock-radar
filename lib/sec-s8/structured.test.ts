import assert from "node:assert/strict";
import test from "node:test";
import { captureS8Document, S8_SOURCE_VERSION, stable } from "./directFacts.ts";
import { buildS8StructuredSource } from "./structuredSource.ts";
import { validateS8Structured, parseS8Structured, S8_STRUCTURED_VERSION, type S8StructuredWire } from "./structuredContract.ts";
import { runS8StructuredAnalyzerPreview, buildS8StructuredPrompt } from "../ai/s8StructuredAnalyzerPreview.ts";
import type { GeminiStructuredJsonRun } from "../ai/geminiStructuredJson.ts";

const accession = "0000000001-26-000001";
const sourceUrl = "https://www.sec.gov/Archives/edgar/data/1/" + accession.replaceAll("-", "") + "/s8.htm";
const additional = "This registration statement registers additional Class A Common Stock under the 2026 Equity Incentive Plan, supplementing Registration No. 333-12345.";
function raw(text = additional, withRow = true, form = "S-8") {
  const html = '<html xmlns:ffd="http://xbrl.sec.gov/ffd/2025"><p>' + text + '</p>' +
    (withRow ? '<xbrli:context id="c1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier></xbrli:entity></xbrli:context>' +
    '<xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>' +
    '<ix:nonNumeric name="ffd:OfferingSctyTitl" contextRef="c1">Class A Common Stock under the 2026 Equity Incentive Plan</ix:nonNumeric>' +
    '<ix:nonFraction name="ffd:AmtSctiesRegd" contextRef="c1" unitRef="shares" format="ixt:num-dot-decimal">1,234</ix:nonFraction>' : "") + '</html>';
  return { source_unique_id: accession, raw_payload: { accession_number: accession, cik: "1",
    form_type: form, filing_date: "2026-01-02", primary_document_url: sourceUrl,
    s8_source: { version: S8_SOURCE_VERSION, documents: [captureS8Document(form, {
      url: sourceUrl, type: form, description: null, isPrimary: true }, html)!] } } };
}
function setup(text = additional, withRow = true, form = "S-8") {
  const input = raw(text, withRow, form), source = buildS8StructuredSource(input);
  const wire = (): S8StructuredWire => ({ version: S8_STRUCTURED_VERSION,
    filing_kind: "unclear", summary: "The supplied filing's purpose is unresolved.",
    current_plans: [], prior_filings: [], key_facts: [], unresolved: ["Plan relationship is unclear."] });
  return { input, source, wire };
}
test("v4 snapshot preserves prose, evidence and server-owned direct values unchanged", () => {
  const { input, source, wire } = setup(), before = stable(input), v = wire();
  v.filing_kind = "registration"; v.summary = "The filing registers additional securities under an equity plan.";
  v.current_plans = [{ name: "2026 Equity Incentive Plan", evidence: ["E1"] }];
  v.prior_filings = [{ reference: "Registration No. 333-12345", relationship: "prior_filing", evidence: ["E1"] }];
  v.key_facts = [{ fact: "This is an additional registration.", evidence: ["E1"] }];
  const result = validateS8Structured(v, source);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.result.semantic, v);
  assert.deepEqual(result.result.directRegistrationRows, source.directRows);
  assert.equal(result.result.directRegistrationRows[0].amountRegistered!.value, "1234");
  assert.equal(stable(input), before);
  assert.equal(result.result.sourceFingerprint, source.fingerprint);
  assert.equal(result.result.evidence[0].documentUrl, sourceUrl);
  assert.equal(result.result.evidence[0].documentId, "D1");
});
test("invalid JSON, duplicate keys and fenced JSON fail without repair", () => {
  const { source, wire } = setup(), fence = String.fromCharCode(96).repeat(3);
  for (const text of ['{"version":', '{"version":"a","version":"b"}', "not JSON", fence + "json\n" + JSON.stringify(wire()) + "\n" + fence])
    assert.equal(parseS8Structured(text, source).ok, false);
});
test("unknown E refs fail in every evidence-bearing field", () => {
  const { source, wire } = setup();
  for (const extra of [{ current_plans: [{ name: "Plan", evidence: ["E999"] }] },
    { prior_filings: [{ reference: "Filing", relationship: "unclear", evidence: ["E999"] }] },
    { key_facts: [{ fact: "Fact", evidence: ["E999"] }] }])
    assert.equal(validateS8Structured({ ...wire(), ...extra }, source).ok, false);
});
test("removed v3 graph and historical entities are not accepted fields", () => {
  const { source, wire } = setup();
  for (const key of ["filing", "plans", "registrations", "references", "amendment", "historical_plans"])
    assert.equal(validateS8Structured({ ...wire(), [key]: [] }, source).ok, false);
  assert.equal(validateS8Structured({ ...wire(), current_plans: [{ name: "Plan", scope: "historical_reference", evidence: [] }] }, source).ok, false);
});
test("required fields, enum and types are enforced", () => {
  const { source, wire } = setup();
  for (const key of Object.keys(wire())) {
    const v: Record<string, unknown> = { ...wire() }; delete v[key];
    assert.equal(validateS8Structured(v, source).ok, false);
  }
  for (const extra of [{ filing_kind: "additional_registration" }, { summary: 42 }, { current_plans: {} },
    { prior_filings: [{ reference: "File", relationship: "amendment_target", evidence: [] }] }, { unresolved: [1] }])
    assert.equal(validateS8Structured({ ...wire(), ...extra }, source).ok, false);
});
for (const key of ["score", "signal", "bullish_points", "bearish_points", "delivery_level", "display_payload", "registered_shares"])
  test("Primary/quantity field forbidden: " + key, () => {
    const { source, wire } = setup();
    assert.equal(validateS8Structured({ ...wire(), [key]: 1 }, source).ok, false);
    assert.equal(validateS8Structured({ ...wire(), current_plans: [{ name: "Plan", evidence: [], [key]: 1 }] }, source).ok, false);
  });
test("model quote and fingerprint echo are not accepted", () => {
  const { source, wire } = setup();
  assert.equal(validateS8Structured({ ...wire(), source_fingerprint: source.fingerprint }, source).ok, false);
  assert.equal(validateS8Structured({ ...wire(), key_facts: [{ fact: "Fact", evidence: ["E1"], quote: additional }] }, source).ok, false);
});
test("false plans, summaries and relationships pass unchanged: no semantic validator", () => {
  const { source, wire } = setup("There is no Example 2023 Plan. This filing is a correction."), v = wire();
  v.filing_kind = "registration"; v.summary = "An unsupported assertion with an invented quantity of 900 shares.";
  v.current_plans = [{ name: "Example 2023 Plan", evidence: ["E1"] }];
  v.prior_filings = [{ reference: "Invented parent", relationship: "current_target", evidence: ["E1"] }];
  v.key_facts = [{ fact: "Unsupported semantic claim.", evidence: ["E1"] }];
  const result = validateS8Structured(v, source);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.result.semantic, v);
});
test("date meaning is not inferred or vetoed by validator", () => {
  const { source, wire } = setup("March 2, 2026 is a price observation date.", false), v = wire();
  v.prior_filings = [{ reference: "Filing of March 2, 2026", relationship: "current_target", evidence: ["E1"] }];
  assert.equal(validateS8Structured(v, source).ok, true);
});
test("free-text uncertainty and empty arrays remain unchanged; no sentence-count repair", () => {
  const { source, wire } = setup(), v = wire();
  v.summary = "One. Two. Three. Four.";
  v.unresolved = ["The source does not establish a relationship."];
  assert.equal(validateS8Structured(v, source).ok, true);
  v.unresolved = [];
  assert.equal(validateS8Structured(v, source).ok, true);
});
test("no direct rows remains unavailable; model cannot supply a new row", () => {
  const { source, wire } = setup("The filing corrects a plan name.", false, "S-8 POS"), v = wire();
  const result = validateS8Structured(v, source);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.result.directRegistrationRows, []);
  assert.equal(validateS8Structured({ ...v, directRegistrationRows: [{ row: "R1" }] }, source).ok, false);
});
test("bounded strings, arrays and E refs are structural constraints", () => {
  const { source, wire } = setup(), v = wire();
  v.summary = "S".repeat(2000);
  assert.equal(validateS8Structured(v, source).ok, true);
  assert.equal(validateS8Structured({ ...v, summary: v.summary + "S" }, source).ok, false);
  for (const extra of [{ summary: "" }, { key_facts: Array(7).fill({ fact: "F", evidence: [] }) },
    { unresolved: Array(6).fill("Unknown") }, { current_plans: [{ name: "N".repeat(1001), evidence: [] }] },
    { current_plans: Array(21).fill({ name: "N", evidence: [] }) },
    { prior_filings: Array(21).fill({ reference: "F", relationship: "prior_filing", evidence: [] }) },
    { key_facts: [{ fact: "F", evidence: Array(9).fill("E1") }] }])
    assert.equal(validateS8Structured({ ...wire(), ...extra }, source).ok, false);
});
test("block order/spans and selected evidence remain source-backed", () => {
  const { source, wire } = setup(("ordinary source text ".repeat(400)) + "Final fact."), v = wire();
  assert.ok(source.evidence.length > 1);
  v.key_facts = [{ fact: "A model claim.", evidence: [source.evidence.at(-1)!.ref] }];
  const result = validateS8Structured(v, source);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.result.evidence[0], source.evidence.at(-1));
  assert.ok(source.evidence[1].start >= source.evidence[0].end);
});

test("package tampering and stored document hash mismatch remain provenance failures", () => {
  const { source, wire } = setup();
  const changed = structuredClone(source); changed.evidence[0].text = "forged";
  assert.equal(validateS8Structured(wire(), changed).ok, false);
  const input = raw(); input.raw_payload.s8_source.documents[0].text += "forged";
  assert.throws(() => buildS8StructuredSource(input));
});
test("truncated source stops before provider", async () => {
  const input = raw(); input.raw_payload.s8_source.documents[0].truncated = true;
  input.raw_payload.s8_source.documents[0].charCount += 1;
  let calls = 0;
  const result = await runS8StructuredAnalyzerPreview(input, { runPrompt: async () => { calls++; throw new Error("not allowed"); } });
  assert.equal(result.stage, "input_error"); assert.equal(calls, 0);
});
test("input has neutral source and direct values, not semantic candidates or Primary interpretation", () => {
  const { input, source } = setup();
  assert.equal("candidates" in source, false);
  const polluted = { ...input, primary_analysis: { score: 100, summary: "invented plan" }, ai_output: "wrong" };
  assert.deepEqual(buildS8StructuredSource(polluted), source);
  const prompt = buildS8StructuredPrompt(source), request = JSON.parse(prompt.user);
  assert.deepEqual(Object.keys(request).sort(), ["direct_registration_rows", "identity", "limitations", "output_contract", "source_blocks"]);
  assert.deepEqual(request.source_blocks[0], { ref: "E1", document_id: "D1", text: source.evidence[0].text });
  assert.equal(request.direct_registration_rows[0].amount_registered, "1234");
  assert.equal(request.direct_registration_rows[0].security_title, source.directRows[0].securityClass.text);
  for (const word of ["candidates", "denied_existence", "historical_context", "planRelationships", "source_fingerprint", "invented plan"])
    assert.equal(prompt.user.includes(word), false);
});
test("one independent call; malformed output returns no snapshot and triggers no repair", async () => {
  const { input, wire } = setup();
  for (const invalid of [false, true]) {
    let calls = 0;
    const result = await runS8StructuredAnalyzerPreview(input, { model: "test", runPrompt: async args => {
      calls++; assert.equal(args.maxOutputTokens, 4000);
      const output = invalid ? { ...wire(), score: 3 } : wire();
      return { ok: true, responseOk: true, status: 200, statusText: "OK", model: "test", responseId: null,
        outputText: JSON.stringify(output), parsed: output, usage: null,
        body: { candidates: [{ finishReason: "STOP" }] } } as GeminiStructuredJsonRun;
    } });
    assert.equal(calls, 1); assert.equal(result.stage, invalid ? "validation_error" : "complete");
    if (invalid) assert.equal(result.result, null);
  }
});
test("MAX_TOKENS remains provider failure even when a JSON fragment parses", async () => {
  const { input, wire } = setup(); let calls = 0;
  const result = await runS8StructuredAnalyzerPreview(input, { runPrompt: async () => {
    calls++; return { ok: true, responseOk: true, status: 200, statusText: "OK", model: "test", responseId: null,
      outputText: JSON.stringify(wire()), parsed: wire(), usage: null,
      body: { candidates: [{ finishReason: "MAX_TOKENS" }] } } as GeminiStructuredJsonRun;
  } });
  assert.equal(calls, 1); assert.equal(result.stage, "provider_error"); assert.equal(result.result, null);
});
