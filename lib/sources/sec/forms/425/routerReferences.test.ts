import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { parseSec425Filing } from "./parser.ts";
import { inspectSec425RouterReferences, normalizeSec425RouterResult, resolveSec425RouterEvidence, sec425RouterResponseSchema } from "./routerPrompt.ts";
import { buildSec425DisplayPayload } from "./displayPayload.ts";
import { buildSec425AnalysisPromptForInput, buildSec425DeterministicAnalysisForInput } from "../../../../ai/sec425AnalysisAdapter.ts";
import type { Sec425RouterDecision } from "./routerPrompt.ts";
import type { SecFilingAnalysisInput } from "../../../../prompts/secFilingAnalysis.ts";

const parser = parseSec425Filing({ filingText: "Example submitted a revised offer on June 1.\n\nThe proposal is non-binding. Closing remains subject to shareholder approval.", companyName: "Synthetic Example" });
const id = parser.raw.router_source_blocks[0].block_id;
const route = () => ({ source_group: "filings", source_form_type: "425", parser_group: "425", event_type: "strategic_transaction", score: 50, expected_delivery_level: "feed", action: "feed", route_case: "acquisition_offer_or_proposal", communication_mode: "offer_letter", transaction_stage: "proposal", display_type: "generic", display_version: "sec_425_display_v1", confidence: "high", needs_analysis_llm: true, archive_like_candidate: false, material_update_present: true, material_update_reason: "A revised proposal was submitted.", needs_parent_context: false, deterministic_stage: null, routing_reason: "Revised proposal.", selected_source_block_ids: [id], source_blocks_used: [id], needs_human_review: false, debug: { parser_version: "sec_425_parser_v2", router_prompt_key: "sec_425_router", router_prompt_version: "v8" } });
const input = { filing_package: { form_type: "425", hard_parsers: { "425": parser } } } as unknown as SecFilingAnalysisInput;

test("new model contract has only source references; copied quotations are forbidden rather than truncated", () => {
  const validate = new Ajv({ strict: false }).compile(sec425RouterResponseSchema);
  assert.equal(validate(route()), true); assert.equal("evidence" in sec425RouterResponseSchema.properties, false);
  const old = { ...route(), evidence: ["x".repeat(480)] }, before = JSON.stringify(old);
  assert.equal(validate(old), false); assert.equal(inspectSec425RouterReferences(old, parser).ok, false);
  assert.throws(() => normalizeSec425RouterResult(old, parser), /obsolete_model_evidence/);
  assert.equal(JSON.stringify(old), before);
});
test("unknown IDs in either raw field fail before normalization; no surviving-ID fallback", () => {
  for (const field of ["selected_source_block_ids", "source_blocks_used"]) {
    const bad = { ...route(), [field]: [id, "unknown"] }, before = JSON.stringify(bad);
    assert.equal(inspectSec425RouterReferences(bad, parser).ok, false);
    assert.throws(() => normalizeSec425RouterResult(bad, parser), /source_reference_invalid/);
    assert.equal(JSON.stringify(bad), before);
  }
  assert.throws(() => resolveSec425RouterEvidence(["unknown"], parser), /source_reference_invalid/);
});
test("display resolves original heading/text and source provenance; block IDs are not rendered as quotations", () => {
  const raw = route(), before = JSON.stringify(raw), normalized = normalizeSec425RouterResult(raw, parser);
  const refs = resolveSec425RouterEvidence(normalized.selected_source_block_ids, parser);
  const payload = buildSec425DisplayPayload(parser, normalized as unknown as Sec425RouterDecision);
  assert.deepEqual(payload.data.router_source_evidence, refs);
  assert.ok(payload.evidence.some(text => text.includes("revised offer")));
  assert.ok(payload.evidence.every(text => text !== id));
  assert.equal(refs[0].text, parser.raw.cleaned_source_blocks.find(b => b.block_id === id)!.text);
  assert.equal(JSON.stringify(raw), before);
});
test("Primary receives original and adjacent condition blocks without duplicate model evidence; archive path remains usable", () => {
  const normalized = normalizeSec425RouterResult(route(), parser);
  const primary = JSON.parse(buildSec425AnalysisPromptForInput(input, normalized).user);
  assert.equal("evidence" in primary.router_result, false);
  assert.ok(primary.cleaned_source_blocks.some((b: { text: string }) => b.text.includes("non-binding")));
  for (const b of primary.cleaned_source_blocks) assert.equal(b.text, parser.raw.cleaned_source_blocks.find(x => x.block_id === b.block_id)!.text);
  const archive = normalizeSec425RouterResult({ ...route(), material_update_present: false, score: 35 }, parser);
  const result = buildSec425DeterministicAnalysisForInput(input, archive);
  assert.equal(result?.ok, true);
  if (result?.ok) assert.ok((result.analysis.display_payload as { evidence: string[] }).evidence.some(s => s.includes("revised offer")));
});
