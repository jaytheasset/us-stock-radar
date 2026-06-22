import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";

registerLocalTsResolutionHook();

const { SEC_FORM25_APPROVED_EVENT_TYPES, parseSecForm25Filing } = await import(new URL("parser.ts", import.meta.url).href);
const { buildSecForm25RouterInput, buildSecForm25RouterPromptDraft, secForm25RouterResponseSchema } = await import(
  new URL("routerPrompt.ts", import.meta.url).href
);

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
assert.ok(routerInput.selected_evidence_snippets.length > 0);
assert.ok(routerInput.source_inventory_summary.document_count > 0);
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

function registerLocalTsResolutionHook() {
  registerHooks({
    resolve(specifier: string, context: any, nextResolve: any) {
      if (specifier.startsWith("./") && !/\.[cm]?[jt]s$/i.test(specifier)) {
        try {
          return nextResolve(`${specifier}.ts`, context);
        } catch {
          return nextResolve(specifier, context);
        }
      }
      return nextResolve(specifier, context);
    },
  });
}
