import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSecForm25Filing } from "./parser";
import {
  buildSecForm25AnalysisInput,
  buildSecForm25AnalysisPromptDraft,
  secForm25RequiredOutputSchema,
} from "./analysisPrompt";

const sentinel = "RAW_FORM25_FULL_TEXT_SENTINEL_SHOULD_NOT_REACH_PROMPTS";
const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "form25", "fixtures");
const parsed = parseSecForm25Filing(readFixture("merger-completion-removal.json"));
const analysisInput = buildSecForm25AnalysisInput({ parser_output: parsed });
const analysisPrompt = buildSecForm25AnalysisPromptDraft({ parser_output: parsed });

assert.equal(analysisPrompt.key, "sec_form25_analysis_draft");
assert.equal(analysisPrompt.version, "v14-related-reason-context");
assert.match(analysisPrompt.system, /removal_reason_context from the matched analyzed related filing/);
assert.equal(
  analysisPrompt.system.includes("formal removal/effectiveness date alone is not new material information"),
  true,
);
assert.equal(
  analysisPrompt.system.includes("do not convert filing_date into that date"),
  true,
);
assert.equal(
  analysisPrompt.system.includes("preserve that fact in summary and continued_listing_or_trading_venue"),
  true,
);
assert.deepEqual(secForm25RequiredOutputSchema.required, ["analysis_output", "display_payload"]);
assert.equal(analysisPrompt.user.includes(sentinel), false, "analysis prompt must not include full raw filing text");
assert.equal(JSON.stringify(analysisInput).includes(sentinel), false, "analysis input must not include raw fixture text");
assert.equal(Object.hasOwn(analysisInput, "bodyText"), false);
assert.equal(Object.hasOwn(analysisInput, "analysisText"), false);
assert.equal(Object.hasOwn(analysisInput, "selected_classification"), false);
assert.equal(Object.hasOwn(analysisInput, "prebuilt_display_payload"), false);
assert.equal(analysisPrompt.system.includes("Choose event_type, display_payload.display_type, score, and signal from cleaned_source_blocks"), true);
assert.equal(analysisPrompt.system.includes("Return prebuilt_display_payload as display_payload exactly"), false);
assert.equal(analysisPrompt.system.includes("ipo_listing is approved globally"), true);
assert.equal(analysisPrompt.system.includes("score 0-39"), true);
assert.equal(analysisPrompt.system.includes("voluntary removal of common equity"), true);
assert.equal(analysisPrompt.system.includes("Automatic unit separation"), true);
assert.equal(analysisPrompt.system.includes("Return [] for archive-level cleanup"), true);
assert.equal(
  analysisInput.output_shape.event_type_policy.includes("cleaned_source_blocks"),
  true
);
const sourceBlocksText = JSON.stringify(analysisInput.cleaned_source_blocks_input.cleaned_source_blocks);
assert.equal(sourceBlocksText.includes("Chevron Corporation"), true);
assert.equal(sourceBlocksText.includes("1.025 shares of Chevron Corporation Common Stock"), true);
assert.equal(sourceBlocksText.includes("form25_exchange_determination"), true);
assert.equal(sourceBlocksText.includes("extracted_source_facts"), false);
assert.equal(sourceBlocksText.includes("source_evidence"), false);
assert.equal(sourceBlocksText.includes("merger_completion"), false);
assert.equal(sourceBlocksText.includes("common_equity_affected"), false);
assert.equal(
  analysisPrompt.system.includes("Parser-extracted values and evidence snippets are internal metadata, not analysis evidence"),
  true,
);
assert.equal(analysisPrompt.system.includes("related_event_update"), true);
assert.equal(analysisPrompt.system.includes("Keep date roles distinct"), true);
assert.equal(analysisPrompt.system.includes("Never describe a trading suspension date"), true);
assert.equal(
  secForm25RequiredOutputSchema.properties.analysis_output.required.includes("form25_lifecycle"),
  true,
);
assert.deepEqual(
  secForm25RequiredOutputSchema.properties.analysis_output.properties.form25_lifecycle.properties.disposition.enum,
  ["standalone_event", "related_event_update", "administrative_cleanup", "context_unresolved"],
);

console.log("sec form25 analysis prompt checks passed");

function readFixture(name: string) {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}
