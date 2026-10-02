import assert from "node:assert/strict";
import test from "node:test";
import { captureS8Document, S8_SOURCE_VERSION, hash, stable } from "./directFacts.ts";
import { buildS8Candidates, MAX_CANDIDATES } from "./structuredCandidates.ts";
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
  const quote = (value: string) => [source.evidence.find(e => e.text.includes(value))!.ref];
  const empty = (): S8StructuredWire => ({ version: S8_STRUCTURED_VERSION, source_fingerprint: source.fingerprint,
    filing: { kind: "ambiguous", evidence: [] }, plans: [],
    registrations: source.directRows.map(r => ({ row: r.ref, relation: "unresolved", plans: [], evidence: [] })),
    references: [], amendment: { effect: "unresolved", evidence: [] }, unresolved: ["plan_relationship"] });
  return { r, source, quote, empty };
}
test("additional registration snapshot binds existing direct values, never model quantities", () => {
  const { r, source, quote, empty } = setup(); const before = stable(r), value = empty();
  value.filing = { kind: "additional_registration", evidence: quote(additional) };
  value.plans = [{ plan: source.candidates.plans.find(p => p.label === "2026 Equity Incentive Plan")!.ref, scope: "current_filing", evidence: quote(additional) }];
  value.registrations[0] = { row: "R1", relation: "source_linked", plans: [source.candidates.plans.find(p => p.label === "2026 Equity Incentive Plan")!.ref], evidence: quote(additional) };
  value.references = [{ reference: source.candidates.references.find(r => r.label === "333-12345")!.ref, role: "additional_registration_to", evidence: quote(additional) }];
  const result = validateS8Structured(value, source);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.result.directRegistrationRows[0].amountRegistered!.value, "1234");
  assert.equal(stable(result.result.semantic), stable(value));
  assert.equal(stable(r), before);
  assert.equal(result.result.evidence[0].documentUrl, sourceUrl);
});
test("historical reference stays separate; correction cannot promote it to additional registration", () => {
  const text = "This amendment corrects the name of the 2021 Plan. That plan was registered on Form S-8 on April 6, 2022.";
  const { source, quote, empty } = setup(text, false, "S-8 POS"); const value = empty();
  value.filing = { kind: "correction", evidence: quote(text) };
  value.amendment = { effect: "corrects_prior", evidence: quote(text) };
  value.references = [{ reference: source.candidates.references.find(r => r.label === "April 6, 2022")!.ref, role: "historical_reference", evidence: quote(text) }];
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
  value.registrations.push({ row: "R1", relation: "unresolved", plans: [], evidence: [] });
  assert.equal(validateS8Structured(value, source).ok, false);
});
test("ambiguous plan relationship remains unresolved; incomplete row coverage is rejected", () => {
  const { source, empty } = setup("Two plans are mentioned; no allocation is specified.");
  const value = empty(); assert.equal(validateS8Structured(value, source).ok, true);
  value.registrations[0].plans = ["Guessed Plan"];
  assert.equal(validateS8Structured(value, source).ok, false);
  value.registrations = []; assert.equal(validateS8Structured(value, source).ok, false);
});
test("forged refs, wrong-file fingerprint and fabricated quotes fail closed", () => {
  const { source, empty, quote } = setup();
  for (const mutate of [
    (v: S8StructuredWire) => { v.source_fingerprint = "another-filing"; },
    (v: S8StructuredWire) => { v.filing = { kind: "additional_registration", evidence: ["E999"] }; },
    (v: S8StructuredWire) => { v.filing = { kind: "additional_registration", evidence: [{ ref: quote(additional)[0], quote: "invented" } as unknown as string] }; },
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
  value.plans = [{ plan: source.candidates.plans.find(p => p.label === "2026 Equity Incentive Plan")!.ref, scope: "current_filing", evidence: quote(additional) },
    { plan: source.candidates.plans.find(p => p.label === "Other Plan")!.ref, scope: "current_filing", evidence: quote("The Other Plan is mentioned historically.") }];
  value.registrations[0] = { row: "R1", relation: "source_linked", plans: [source.candidates.plans.find(p => p.label === "Other Plan")!.ref], evidence: quote("The Other Plan is mentioned historically.") };
  assert.equal(validateS8Structured(value, source).ok, false);
});
test("invented plan and historical-reference identities fail the closed schema", () => {
  const { source, empty, quote } = setup(); const v = empty();
  v.plans = [{ plan: "Invented Plan", scope: "current_filing", evidence: quote(additional) }];
  assert.equal(validateS8Structured(v, source).ok, false);
  v.plans = [];
  v.references = [{ reference: "333-999999", role: "historical_reference", evidence: quote(additional) }];
  assert.equal(validateS8Structured(v, source).ok, false);
});
test("denied existence is rejected even when selected as historical", () => {
  const text = "There is no Example 2023 Incentive Award Plan. The only plan is the Example 2021 Incentive Award Plan.";
  const { source, empty, quote } = setup(text, false);
  const denied = source.candidates.plans.find(p => p.label === "Example 2023 Incentive Award Plan")!;
  assert.ok(denied.occurrences.some(o => o.guards.includes("denied_existence")));
  for (const scope of ["current_filing", "historical_reference", "unresolved"] as const) {
    const v = empty(); v.plans = [{ plan: denied.ref, scope, evidence: quote(text) }];
    const result = validateS8Structured(v, source);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.includes("plan:denied_existence"));
  }
  const v = empty();
  v.plans = [{ plan: source.candidates.plans.find(p => p.label === "Example 2021 Incentive Award Plan")!.ref,
    scope: "current_filing", evidence: quote(text) }];
  assert.equal(validateS8Structured(v, source).ok, true);
});
for (const text of [
  "No shares under the 2021 Equity Incentive Plan are registered here.",
  "This filing does not relate to the 2021 Equity Incentive Plan.",
  "Shares are not registered under the 2021 Equity Incentive Plan.",
  "No additional securities under the 2021 Equity Incentive Plan are registered.",
  "This filing does not amend the 2021 Equity Incentive Plan.",
  "This filing supersedes the 2021 Equity Incentive Plan.",
  "This filing replaces the 2021 Equity Incentive Plan.",
]) test("negative relationship cannot supply current plan: " + text, () => {
  const { source, empty, quote } = setup(text, false);
  const v = empty(); v.plans = [{ plan: source.candidates.plans[0].ref, scope: "current_filing", evidence: quote(text) }];
  const result = validateS8Structured(v, source); assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.includes("plan:current_scope_not_supported"));
  v.plans[0].scope = "unresolved";
  assert.equal(validateS8Structured(v, source).ok, true);
});
test("historical-only plan is allowed historically but cannot become current", () => {
  const text = "The 2020 Equity Incentive Plan was previously registered on Form S-8 on April 6, 2020.";
  const { source, empty, quote } = setup(text, false);
  const v = empty(); v.plans = [{ plan: source.candidates.plans[0].ref, scope: "historical_reference", evidence: quote(text) }];
  assert.equal(validateS8Structured(v, source).ok, true);
  v.plans[0].scope = "current_filing";
  assert.equal(validateS8Structured(v, source).ok, false);
});
test("closed refs span block boundaries without regenerating or truncating quotes", () => {
  const text = ("ordinary source text ".repeat(195)).slice(0, 3985) + "Example 2026 Equity Incentive Plan is the current registration plan.";
  const { source, empty } = setup(text, false);
  const p = source.candidates.plans.find(p => p.label.includes("2026 Equity Incentive Plan"))!;
  const occurrence = p.occurrences[0];
  assert.ok(occurrence.evidence.length >= 2);
  const v = empty(); v.plans = [{ plan: p.ref, scope: "current_filing", evidence: occurrence.evidence }];
  const result = validateS8Structured(v, source); assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.result.plans[0].candidate.occurrences[0], occurrence);
    assert.equal(result.result.evidence.map(e => e.text).join(" ").includes("Example 2026"), true);
  }
  v.plans[0].evidence = occurrence.evidence.slice(1);
  assert.equal(validateS8Structured(v, source).ok, false);
});
test("a source-backed name over old string limit is selectable without free strings", () => {
  const name = "Abc".repeat(130) + " 2026 Equity Incentive Plan";
  assert.ok(name.length > 400);
  const { source, empty } = setup("Registration under " + name + ".", false);
  const v = empty(); v.plans = [{ plan: source.candidates.plans[0].ref, scope: "current_filing", evidence: ["E1"] }];
  const result = validateS8Structured(v, source); assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.result.plans[0].candidate.label, name);
});
test("evidence selection limits remain enforced (8 accepted, 9 refused)", () => {
  const { source, empty } = setup(Array.from({ length: 10 }, (_, i) => ("section " + i + " ").repeat(400)).join("\n\n"), false);
  assert.ok(source.evidence.length >= 9);
  const v = empty(); v.filing = { kind: "initial_registration", evidence: source.evidence.slice(0, 8).map(e => e.ref) };
  assert.equal(validateS8Structured(v, source).ok, true);
  v.filing.evidence = source.evidence.slice(0, 9).map(e => e.ref);
  assert.equal(validateS8Structured(v, source).ok, false);
});
test("candidate limit fails input, never silently truncates a closed candidate set", () => {
  const text = Array.from({ length: MAX_CANDIDATES }, (_, i) => "The 2026 Unique" + i + " Plan.").join(" ");
  const doc = { documentUrl: sourceUrl, text }, block = { ref: "E1", documentUrl: sourceUrl,
    documentSha256: hash(text), normalizedSha256: hash(text), start: 0, end: text.length, text };
  assert.equal(buildS8Candidates([doc], [block]).plans.length, MAX_CANDIDATES);
  const extra = text + " The 2027 Overflow Plan.";
  assert.throws(() => buildS8Candidates([{ ...doc, text: extra }], [{ ...block, end: extra.length, text: extra }]), /candidate_limit/);
});
test("unknown refs and another valid filing package cannot be substituted", () => {
  const { source, empty } = setup(); const v = empty();
  v.filing = { kind: "initial_registration", evidence: ["E0"] };
  assert.equal(validateS8Structured(v, source).ok, false);
  v.filing.evidence = ["E1"];
  const other = setup("Other filing evidence.", false).source;
  assert.equal(validateS8Structured(v, other).ok, false);
});
test("two adjacent named plans remain separate lexical candidates", () => {
  const { source } = setup("2021 Equity Incentive Plan\n2021 Employee Stock Purchase Plan", false);
  assert.deepEqual(source.candidates.plans.map(p => p.label), ["2021 Equity Incentive Plan", "2021 Employee Stock Purchase Plan"]);
});
test("telephone suffix is not a registration reference candidate", () => {
  const { source } = setup("Call (206) 333-2001. Registration No. 333-12345 is incorporated.", false);
  assert.deepEqual(source.candidates.references.map(r => r.label), ["333-12345"]);
});
