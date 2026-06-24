import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SEC_FORM25_APPROVED_EVENT_TYPES, parseSecForm25Filing } from "./parser";
import { buildSecForm25RouterInput, buildSecForm25RouterPromptDraft, secForm25RouterResponseSchema } from "./routerPrompt";

const sentinel = "RAW_FORM25_FULL_TEXT_SENTINEL_SHOULD_NOT_REACH_PROMPTS";
const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "form25", "fixtures");
const parsed = parseSecForm25Filing(readFixture("common-share-delisting.json"));
const routerInput = buildSecForm25RouterInput({ parser_output: parsed });
const routerPrompt = buildSecForm25RouterPromptDraft({ parser_output: parsed });

assert.equal(SEC_FORM25_APPROVED_EVENT_TYPES.length, 16);
assert.ok(SEC_FORM25_APPROVED_EVENT_TYPES.includes("listing_risk"));
assert.ok(SEC_FORM25_APPROVED_EVENT_TYPES.includes("strategic_transaction"));
assert.ok(SEC_FORM25_APPROVED_EVENT_TYPES.includes("financial_risk"));
assert.ok(SEC_FORM25_APPROVED_EVENT_TYPES.includes("legal_risk"));
assert.ok(SEC_FORM25_APPROVED_EVENT_TYPES.includes("ipo_listing"));
assert.ok(SEC_FORM25_APPROVED_EVENT_TYPES.includes("other"));

assert.equal(routerPrompt.key, "sec_form25_router_draft");
assert.equal(routerPrompt.user.includes(sentinel), false, "router prompt must not include full raw filing text");
assert.equal(JSON.stringify(routerInput).includes(sentinel), false, "router input must not include raw fixture text");
assert.equal(Object.hasOwn(routerInput, "bodyText"), false);
assert.equal(Object.hasOwn(routerInput, "analysisText"), false);
assert.ok(routerInput.cleaned_source_blocks.length > 0);
assert.ok(routerInput.cleaned_source_blocks.some((block) => block.block_type === "source_evidence"));
assert.ok(routerInput.cleaned_source_blocks.some((block) => block.block_type === "source_inventory"));
assert.deepEqual(secForm25RouterResponseSchema.properties.event_type.enum, SEC_FORM25_APPROVED_EVENT_TYPES);
assert.deepEqual(secForm25RouterResponseSchema.properties.display_type.enum, [
  "sec_form25_listing_removal",
  "generic",
  "candidate_special",
]);
assert.equal(secForm25RouterResponseSchema.required.includes("display_version"), true);
assert.equal(secForm25RouterResponseSchema.required.includes("analysis_llm_needed"), true);
assert.equal(secForm25RouterResponseSchema.required.includes("score"), false);
assert.equal(secForm25RouterResponseSchema.required.includes("action"), false);

console.log("sec form25 router prompt checks passed");

function readFixture(name: string) {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}
