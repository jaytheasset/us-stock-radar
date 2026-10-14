import test from "node:test";
import assert from "node:assert/strict";
import { compileSec425MonitorPreview, SEC425_COMPILER_PREVIEW_SCOPE, buildSec425MonitorPreview } from "./sec425CandidatePreview.ts";
import { SEC425_MONITOR_EXAMPLES, formatSec425PreviewValue } from "./sec425CandidateDisplay.ts";
import { getReadyMonitorCondition } from "./conditionRegistry.ts";
import { validateCanonicalListingConditions } from "./listingMonitorPersistence.ts";
import { createListingMonitorDraftReview, getListingMonitorDraftCreateGate } from "./listingMonitorDraftReview.ts";
import { evaluateMonitorConditions } from "../listingMonitorMatcher.ts";
import { validateNaturalLanguageConditionCompilerOutput } from "./naturalLanguageConditionCompiler.ts";
import { handleSec425PreviewPost } from "../../app/api/monitors/listing/compile/425-preview/handler.ts";
import { requestSec425MonitorPreview } from "./sec425CandidateClient.ts";

const condition = { key: "sec425.announcement_type", operator: "eq", value: "revised_acquisition_proposal" };
const output = (text: string, conditions: unknown[] = [condition]) => ({ requirements: [{ source_text: text, decision: "mapped", conditions, reason: null, question: null }] });
const options = (parsed: Record<string, unknown>, onPrompt?: (system: string, user: string) => void) => ({ apiKey: "fixture-only-not-live", model: "fixture-model", runPrompt: async (request: { prompt: { system: string; user: string }; model: string }) => {
  onPrompt?.(request.prompt.system, request.prompt.user);
  return { ok: true, responseOk: true, status: 200, statusText: "OK", model: request.model, responseId: "synthetic-provider-fixture", outputText: JSON.stringify(parsed), parsed, usage: null, body: null };
} });
test("four editable examples have no precompiled canonical conditions", () => { assert.equal(SEC425_MONITOR_EXAMPLES.length, 4); assert.ok(SEC425_MONITOR_EXAMPLES.every(v => typeof v === "string")); });
test("candidate submit sends one unchanged text request to preview only; no implicit create or second compiler call", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, init) => { calls++; assert.equal(url, "/api/monitors/listing/compile/425-preview"); assert.deepEqual(JSON.parse(String(init?.body)), { text: SEC425_MONITOR_EXAMPLES[0] }); return new Response("{}", { status: 200 }); };
  try { await requestSec425MonitorPreview(SEC425_MONITOR_EXAMPLES[0]); assert.equal(calls, 1); } finally { globalThis.fetch = original; }
});
test("425 review displays readable labels instead of internal announcement enums", () => {
  assert.equal(formatSec425PreviewValue({ key: "sec425.announcement_type", label: "Current announcement", value: "revised_acquisition_proposal" }), "Revised acquisition proposal");
  assert.equal(formatSec425PreviewValue({ key: "sec425.announcement_type", label: "Current announcement", value: "definitive_agreement_signed" }), "Definitive agreement signed");
});
test("uses existing compiler prompt and requirement ledger with scoped catalog; actual provider0 fixture only", async () => {
  const text = SEC425_MONITOR_EXAMPLES[1]; let calls = 0;
  const r = await compileSec425MonitorPreview(text, options(output(text), (system, user) => {
    calls++; assert.equal(JSON.parse(user).text, text); assert.ok(system.includes("atomic semantic requirements")); assert.ok(system.includes("sec425.announcement_type"));
  }));
  assert.equal(calls, 1); assert.equal(r.preview.interpretation, "VALID"); assert.equal(r.preview.requirements[0].id, "r1");
  assert.deepEqual(r.preview.requirements[0].condition_refs, ["c1"]); assert.equal(r.preview.canSave, false);
  assert.equal(getListingMonitorDraftCreateGate(createListingMonitorDraftReview(r.draft)).ready, false);
});
test("unsupported and ambiguous free text preserve reasons/questions; no local sentence parser", async () => {
  for (const decision of ["unsupported", "ambiguous"] as const) {
    const text = "Track the next deal for my company and predict the gain.";
    const parsed = { requirements: [{ source_text: text, decision, conditions: [], reason: decision === "unsupported" ? "Price predictions are unsupported." : null, question: decision === "ambiguous" ? "Which company and which announcement?" : null }] };
    const r = await compileSec425MonitorPreview(text, options(parsed));
    assert.equal(r.preview.interpretation, decision === "unsupported" ? "UNSUPPORTED" : "AMBIGUOUS"); assert.equal(r.preview.conditions.length, 0); assert.equal(r.preview.canAlert, false);
  }
});
test("multiple transaction tags coexist; unqualified or inferred company symbols are rejected", () => {
  const r = SEC425_COMPILER_PREVIEW_SCOPE.validateConditions([{ key: "sec425.transaction.merger", operator: "eq", value: true }, { key: "sec425.transaction.tender_offer", operator: "eq", value: true }]);
  assert.equal(r.ok, true);
  assert.equal(SEC425_COMPILER_PREVIEW_SCOPE.validateConditions([{ key: "sec425.acquirer_ticker", operator: "eq", value: "Example Company" }]).ok, false);
  assert.equal(SEC425_COMPILER_PREVIEW_SCOPE.validateConditions([{ key: "sec425.transaction.merger", operator: "eq", value: false }]).ok, false);
});
test("registered425 remains disabled for saving and generic event matching outside candidate runtime", async () => {
  assert.equal(getReadyMonitorCondition(condition.key)?.family, "sec425"); assert.equal(validateCanonicalListingConditions([condition]).ok, true);
  const {allowedUser}=await import("../sec425/consumer.ts");assert.equal(await allowedUser("fixture-user"),false);
  const r = evaluateMonitorConditions({ listing: { status: "not_ready", reason: "fixture" }, corporateAction: { status: "not_ready", reason: "fixture" }, ownership: { status: "not_ready", reason: "fixture" } }, [condition], { evaluationDate: "2026-10-15" });
  assert.equal(r.status, "ineligible"); assert.notEqual(r.reasonCode, "all_conditions_match");
});
test("compiler recognizes the newly supported425 keys while preserving existing-family conditions", () => {
  const text = "Watch a revised offer.";
  assert.equal(validateNaturalLanguageConditionCompilerOutput(output(text), text).status, "VALID");
  const standard = validateNaturalLanguageConditionCompilerOutput(output(text, [{ key: "market.price", operator: "lt", value: 1 }]), text);
  assert.equal(standard.status, "VALID");
});
test("candidate API retains auth/origin gates and returns blocked preview; no storage call", async () => {
  const text = SEC425_MONITOR_EXAMPLES[1]; let called = 0;
  const compile = async (input: string) => { called++; return compileSec425MonitorPreview(input, options(output(input))); };
  const request = (origin = "http://localhost") => new Request("http://localhost/api/monitors/listing/compile/425-preview", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  assert.equal((await handleSec425PreviewPost(request(), { resolveUserId: async () => null, compile })).status, 401); assert.equal(called, 0);
  assert.equal((await handleSec425PreviewPost(request("https://other.example"), { resolveUserId: async () => "fixture-user", compile })).status, 403); assert.equal(called, 0);
  const response = await handleSec425PreviewPost(request(), { resolveUserId: async () => "fixture-user", compile });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.preview.status, "not_ready"); assert.deepEqual(body.data.conditions, []); assert.equal(called, 1);
});
test("forged ledger fails before preview; readiness cannot be changed by compiler output", () => {
  const text = "Watch a revised offer.";
  const result = validateNaturalLanguageConditionCompilerOutput(output(text), text, SEC425_COMPILER_PREVIEW_SCOPE);
  const changed = structuredClone(result); (changed.ledger.conditions[0] as { id: string }).id = "forged";
  assert.throws(() => buildSec425MonitorPreview(changed, text), /validation/);
});

test("enabled candidate uses existing review/create gate, without bypassing unsupported requests",async()=>{
 const before=process.env.SEC425_MONITOR_ENABLED;process.env.SEC425_MONITOR_ENABLED="true";try{const text=SEC425_MONITOR_EXAMPLES[1];const r=await compileSec425MonitorPreview(text,options(output(text)));assert.equal(r.preview.canSave,true);assert.equal(getListingMonitorDraftCreateGate(createListingMonitorDraftReview(r.draft)).ready,true);}finally{if(before===undefined)delete process.env.SEC425_MONITOR_ENABLED;else process.env.SEC425_MONITOR_ENABLED=before;}
});
