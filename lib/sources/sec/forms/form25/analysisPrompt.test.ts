import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";

registerLocalTsResolutionHook();

const { parseSecForm25Filing } = await import(new URL("parser.ts", import.meta.url).href);
const {
  buildSecForm25AnalysisInput,
  buildSecForm25AnalysisPromptDraft,
  buildSecForm25DisplayPayload,
  secForm25RequiredOutputSchema,
  summarizeForm25ForDisplay,
} = await import(new URL("analysisPrompt.ts", import.meta.url).href);

const sentinel = "RAW_FORM25_FULL_TEXT_SENTINEL_SHOULD_NOT_REACH_PROMPTS";
const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "form25", "fixtures");
const parsed = parseSecForm25Filing(readFixture("merger-completion-removal.json"));
const routerResult = {
  source_group: "filings",
  source_form_type: "25-NSE",
  analysis_family: "sec_form25_listing_removal",
  event_type: "strategic_transaction",
  display_type: "sec_form25_listing_removal",
  display_version: "sec_form25_listing_removal_v1",
  confidence: "high",
  route_case: "merger_completion_removal",
  routing_reason: "Completed merger removal.",
  analysis_llm_needed: false,
  evidence: ["The merger between Hess Corporation and Chevron Corporation became effective."],
  parser_facts_used: ["removal_reason_category", "consideration_summary"],
  needs_human_review: false,
  debug: {
    parser_version: "sec_form25_parser_v1",
    router_prompt_key: "sec_form25_router_draft",
    router_prompt_version: "v1"
  }
};
const analysisInput = buildSecForm25AnalysisInput({ parser_output: parsed, router_result: routerResult });
const analysisPrompt = buildSecForm25AnalysisPromptDraft({ parser_output: parsed, router_result: routerResult });

assert.equal(analysisPrompt.key, "sec_form25_analysis_draft");
assert.deepEqual(secForm25RequiredOutputSchema.required, ["parser_output", "analysis_output", "display_payload", "fixture_expected"]);
assert.equal(analysisPrompt.user.includes(sentinel), false, "analysis prompt must not include full raw filing text");
assert.equal(JSON.stringify(analysisInput).includes(sentinel), false, "analysis input must not include raw fixture text");
assert.equal(Object.hasOwn(analysisInput, "bodyText"), false);
assert.equal(Object.hasOwn(analysisInput, "analysisText"), false);
assert.equal(analysisInput.selected_classification.event_type, "strategic_transaction");
assert.equal(analysisInput.selected_classification.display_type, "sec_form25_listing_removal");
assert.equal(analysisInput.prebuilt_display_payload.display_version, "sec_form25_listing_removal_v1");
assert.equal(analysisInput.prebuilt_display_payload.data.ipo_kind, null);
assert.equal(analysisPrompt.system.includes("Do not choose the event type"), true);
assert.equal(analysisPrompt.system.includes("Return prebuilt_display_payload as display_payload exactly"), true);
assert.equal(analysisPrompt.system.includes("ipo_listing is approved globally"), true);
assert.equal(analysisPrompt.system.includes("score 0-39"), true);
assert.equal(
  analysisInput.output_shape.event_type_policy.includes("selected_classification.event_type"),
  true
);
const displayData = summarizeForm25ForDisplay(parsed);
assert.equal(displayData.accession_number, "0000876661-25-000523");
assert.equal(displayData.source_form_type, "25-NSE");
assert.equal(displayData.issuer_name, "HESS CORP");
assert.equal(displayData.primary_ticker, "HES");
assert.equal(displayData.primary_ticker_exchange, "NYSE");
assert.equal(displayData.removed_security, "Common Stock");
assert.equal(displayData.security_category, "common_stock");
assert.equal(displayData.exchange, "NEW YORK STOCK EXCHANGE LLC");
assert.equal(displayData.rule_provision, "17 CFR 240.12d2-2(a)(3)");
assert.equal(displayData.removal_reason, "merger_completion");
assert.equal(displayData.removal_reason_text.includes("Chevron Corporation became effective"), true);
assert.equal(displayData.common_equity_affected, true);
assert.equal(displayData.delisting_or_removal_date, "2025-07-29");
assert.equal(displayData.trading_suspension_date, "2025-07-18");
assert.equal(displayData.successor_or_acquirer, "Hess Corporation / Chevron Corporation");
assert.equal(displayData.ipo_kind, null);
assert.equal(displayData.deterministic_case, "merger_completion_removal");
assert.equal(displayData.router_required, false);
assert.equal(buildSecForm25DisplayPayload(parsed, analysisInput.selected_classification).display_type, "sec_form25_listing_removal");

console.log("sec form25 analysis prompt checks passed");

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
