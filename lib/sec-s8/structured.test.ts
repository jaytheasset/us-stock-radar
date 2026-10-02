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
    filing: { kind: "ambiguous", evidence: [] }, plans: [],
    registrations: source.directRows.map(r => ({ row: r.ref, relation: "unresolved", plans: [], evidence: [] })),
    references: [], amendment: { effect: "unresolved", evidence: [] }, unresolved: ["plan_relationship"] });
  return { input, source, wire };
}
test("valid structural response binds source and direct values without rewriting model analysis", () => {
  const { input, source, wire } = setup(), before = stable(input), value = wire();
  value.filing = { kind: "additional_registration", evidence: ["E1"] };
  value.plans = [{ name: "2026 Equity Incentive Plan", scope: "current_filing", evidence: ["E1"] }];
  value.registrations[0] = { row: "R1", relation: "linked", plans: ["2026 Equity Incentive Plan"], evidence: ["E1"] };
  value.references = [{ reference_text: "Registration No. 333-12345", role: "additional_registration_to", evidence: ["E1"] }];
  const result = validateS8Structured(value, source);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.result.directRegistrationRows[0].amountRegistered!.value, "1234");
  assert.deepEqual(result.result.semantic, value);
  assert.equal(stable(input), before);
  assert.equal(result.result.sourceFingerprint, source.fingerprint);
  assert.equal(result.result.evidence[0].documentUrl, sourceUrl);
  assert.equal(result.result.evidence[0].documentId, "D1");
});
test("invalid JSON and duplicate JSON keys fail", () => {
  const { source } = setup();
  for (const text of ['{"version":', '{"version":"a","version":"b"}', "not JSON"])
    assert.equal(parseS8Structured(text, source).ok, false);
});
test("unknown evidence ref fails", () => {
  const { source, wire } = setup(), v = wire();
  v.filing.evidence = ["E999"];
  assert.equal(validateS8Structured(v, source).ok, false);
});
test("unknown row ref fails", () => {
  const { source, wire } = setup(), v = wire();
  v.registrations[0].row = "R999";
  assert.equal(validateS8Structured(v, source).ok, false);
});
test("invalid enum fails", () => {
  const { source, wire } = setup(), v = wire();
  assert.equal(validateS8Structured({ ...v, filing: { kind: "issued", evidence: ["E1"] } }, source).ok, false);
});
test("required fields and types are enforced", () => {
  const { source, wire } = setup(), v = wire();
  const { plans: _plans, ...missing } = v;
  assert.equal(validateS8Structured(missing, source).ok, false);
  assert.equal(validateS8Structured({ ...v, plans: {} }, source).ok, false);
});
for (const key of ["score", "signal", "bullish_points", "bearish_points", "delivery_level", "display_payload", "registered_shares"])
  test("Primary/quantity field forbidden: " + key, () => {
    const { source, wire } = setup(), value = wire();
    assert.equal(validateS8Structured({ ...value, [key]: 1 }, source).ok, false);
    Object.assign(value.filing, { [key]: 1 });
    assert.equal(validateS8Structured(value, source).ok, false);
  });
test("raw quotes and model fingerprint echo are not part of v3", () => {
  const { source, wire } = setup(), v = wire();
  assert.equal(validateS8Structured({ ...v, source_fingerprint: source.fingerprint }, source).ok, false);
  assert.equal(validateS8Structured({ ...v, filing: { ...v.filing, quote: additional } }, source).ok, false);
});
test("valid arbitrary semantic combination passes unchanged: validator is not a semantic judge", () => {
  const { source, wire } = setup("There is no Example 2023 Plan. This is a correction, not additional registration.");
  const v = wire();
  v.filing = { kind: "initial_registration", evidence: ["E1"] };
  v.plans = [{ name: "Example 2023 Plan", scope: "current_filing", evidence: ["E1"] }];
  v.registrations[0] = { row: "R1", relation: "linked", plans: ["A Different Plan Not In Source"], evidence: ["E1"] };
  v.references = [{ reference_text: "A nonexistent parent", role: "additional_registration_to", evidence: ["E1"] }];
  v.amendment = { effect: "deregisters_unsold", evidence: ["E1"] };
  const result = validateS8Structured(v, source);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.result.semantic, v);
});
test("name and date roles are not inferred or vetoed by validation", () => {
  const { source, wire } = setup("The 2020 Plan is a historical reference. March 2, 2026 is a market-price date.", false);
  const v = wire();
  v.plans = [{ name: "2020 Plan", scope: "current_filing", evidence: ["E1"] }];
  v.references = [{ reference_text: "March 2, 2026", role: "amendment_target", evidence: ["E1"] }];
  assert.equal(validateS8Structured(v, source).ok, true);
});
test("structurally valid unresolved combinations and missing relations are preserved, not repaired", () => {
  const { source, wire } = setup(), v = wire();
  v.registrations[0] = { row: "R1", relation: "unresolved", plans: ["Model inconsistency"], evidence: [] };
  assert.equal(validateS8Structured(v, source).ok, true);
  v.registrations = [];
  assert.equal(validateS8Structured(v, source).ok, true);
});
test("zero direct rows allow no invented R row", () => {
  const { source, wire } = setup("This filing corrects the plan name.", false, "S-8 POS"), v = wire();
  assert.equal(validateS8Structured(v, source).ok, true);
  v.registrations = [{ row: "R1", relation: "unresolved", plans: [], evidence: [] }];
  assert.equal(validateS8Structured(v, source).ok, false);
});
test("string and reference-count boundaries remain structural", () => {
  const { source, wire } = setup(), v = wire();
  v.plans = [{ name: "N".repeat(1000), scope: "amendment_target", evidence: ["E1"] }];
  assert.equal(validateS8Structured(v, source).ok, true);
  v.plans[0].name += "N";
  assert.equal(validateS8Structured(v, source).ok, false);
  v.plans[0].name = "";
  assert.equal(validateS8Structured(v, source).ok, false);
  v.plans = []; v.filing.evidence = Array(9).fill("E1");
  assert.equal(validateS8Structured(v, source).ok, false);
});
test("blocks retain order and allow a source boundary to be cited without model quotes", () => {
  const { source, wire } = setup(("ordinary source text ".repeat(195)).slice(0, 3985) + "Example 2026 Equity Incentive Plan.", false);
  assert.ok(source.evidence.length > 1);
  assert.ok(source.evidence.every(e => e.documentId === "D1"));
  for (let i = 1; i < source.evidence.length; i++) assert.ok(source.evidence[i].start >= source.evidence[i - 1].end);
  const v = wire(); v.plans = [{ name: "Example 2026 Equity Incentive Plan", scope: "current_filing", evidence: ["E1", "E2"] }];
  const result = validateS8Structured(v, source);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.result.evidence, source.evidence.slice(0, 2));
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
