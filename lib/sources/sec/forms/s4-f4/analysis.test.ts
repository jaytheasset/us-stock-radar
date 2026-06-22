import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildS4F4AnalysisPrompt, validateRequiredOutputJson } from "./analysisPrompt.ts";
import { buildS4F4GenericAnalysisPlan } from "./analysisPrompt.ts";
import { parseS4F4Filing } from "./parser.ts";
import {
  APPROVED_EVENT_TYPES,
  deriveDeliveryLevel,
  type RequiredOutputJson,
  type S4F4Fixture,
} from "./types.ts";

const roomDir = dirname(fileURLToPath(import.meta.url));

runAnalysisFixtureTests();

function runAnalysisFixtureTests(): void {
  for (const id of fixtureIds()) {
    const fixture = readJson<S4F4Fixture>(join(roomDir, "fixtures", `${id}.json`));
    const expected = readJson<RequiredOutputJson>(join(roomDir, "expected", `${id}.expected.json`));
    const parsed = parseS4F4Filing(fixture);
    const analysisPlan = buildS4F4GenericAnalysisPlan();
    const prompt = buildS4F4AnalysisPrompt(parsed, analysisPlan, fixture.market_context, null, fixture.parentFilingContext);
    const validationErrors = validateRequiredOutputJson(expected);

    assert.deepEqual(validationErrors, [], id);
    assert.ok(APPROVED_EVENT_TYPES.includes(expected.analysis_output.event_type), id);
    assert.equal(deriveDeliveryLevel(expected.analysis_output.score), expected.fixture_expected.expected_delivery_level, id);
    assert.ok(prompt.includes("Required Output JSON shape"), id);
    assert.ok(prompt.includes("Score bands are fixed"), id);
    assert.ok(prompt.includes("Cleaned source blocks"), id);
    assert.ok(prompt.includes("Parent filing context"), id);
    assert.ok(prompt.includes("If parent filing context is missing, do not invent amendment deltas"), id);
    assert.ok(prompt.includes("Do not use parser facts"), id);
    assert.ok(!prompt.includes("Parser output:"), id);
    assert.ok(!prompt.includes("Do not change event_type"), id);
    assert.ok(!prompt.includes("Do not call live FMP"), id);
    assert.ok(!prompt.includes("Prebuilt display_payload"), id);
    assert.ok(prompt.includes("Build display_payload directly from cleaned_source_blocks"), id);
    assert.ok(prompt.includes("Choose exactly one event_type from these 16 approved values"), id);
    assert.ok(prompt.includes("First identify the S-4/F-4 filing subtype"), id);
    assert.ok(prompt.includes("new actionable impact of the filing"), id);
    assert.ok(prompt.includes("S-4/F-4 subtype: merger, acquisition, share exchange, or business combination"), id);
    assert.ok(prompt.includes("base score is 60-74 when the filing provides transaction terms"), id);
    assert.ok(prompt.includes("S-4/F-4 subtype: SPAC/de-SPAC business combination or status update"), id);
    assert.ok(prompt.includes("Use event_type=strategic_transaction for de-SPAC progress"), id);
    assert.ok(prompt.includes("de-SPAC scoring is based on newly confirmed status change"), id);
    assert.ok(prompt.includes("de-SPAC base score 70-74"), id);
    assert.ok(prompt.includes("Calculate redemption rate only when source blocks or market_context provide"), id);
    assert.ok(prompt.includes("Do not use generic shares outstanding, current float, market cap, or post-redemption trading data"), id);
    assert.ok(prompt.includes("If redemption share count or amount is disclosed but redemption rate"), id);
    assert.ok(prompt.includes("Redemption rate 70%+ can be 75+ only if it pressures"), id);
    assert.ok(prompt.includes("Ticker change alone without closing confirmation is 60-70"), id);
    assert.ok(prompt.includes("For S-4/F-4 de-SPAC filings, most scores should be 60-74"), id);
    assert.ok(prompt.includes("Do not use ipo_listing for de-SPAC transaction status"), id);
    assert.ok(prompt.includes("Use event_type=shareholder_vote with base score 50-64"), id);
    assert.ok(prompt.includes("score 75+ only for actual vote result"), id);
    assert.ok(prompt.includes("S-4/F-4 subtype: exchange offer, share exchange, or registered share issuance"), id);
    assert.ok(prompt.includes("Base score is 55-74"), id);
    assert.ok(prompt.includes("Registered or maximum shares alone should not drive dilution_risk or 75+"), id);
    assert.ok(prompt.includes("Routine note registration exchange"), id);
    assert.ok(prompt.includes("Base score is 65-85"), id);
    assert.ok(prompt.includes("Routine merger litigation"), id);
    assert.ok(prompt.includes("Base score is 55-75"), id);
    assert.ok(prompt.includes("base score is 20-45"), id);
    assert.ok(prompt.includes("base score is 10-35"), id);
    assert.ok(prompt.includes("Alert scoring 75+ requires strong actionable impact"), id);
    assert.ok(prompt.includes("S-4/F-4 generally is not a traditional IPO form"), id);
    assert.ok(prompt.includes("listing effectiveness or first public listing itself"), id);
    assert.ok(!prompt.includes("preserve display_payload.data.ipo_kind"), id);
    assert.ok(prompt.includes("Always output display_payload.display_type=generic"), id);
    assert.ok(prompt.includes("Do not use spac_transaction_status for S-4/F-4"), id);
    assert.ok(!prompt.includes("convert it to generic"), id);
    assert.ok(prompt.includes("De-SPAC filing details belong in quick_take, summary, why_it_matters, key_evidence, and what_to_watch_next"), id);
    assert.ok(!prompt.includes("critical output is display_payload.display_type=spac_transaction_status"), id);
    assert.ok(!prompt.includes("Useful optional spac_transaction_status fields"), id);
    assert.ok(prompt.includes("Do not treat a plain blank-check IPO registration"), id);
    assert.ok(prompt.includes("Registered or maximum shares alone should not drive dilution_risk or 75+"), id);
    assert.ok(prompt.includes("Filing-fee table quantities are not primary evidence of dilution"), id);
    assert.ok(prompt.includes("cite pro forma ownership, capitalization, weighted-average shares"), id);
    assert.ok(prompt.includes("Use definitive wording only when final issuance"), id);
    assert.ok(prompt.includes("distinguish the issuer/acquirer perspective from the target/shareholder perspective"), id);
    assert.ok(prompt.includes("set market_context_needed=true and name the missing fields"), id);
    assert.ok(prompt.includes("current-market premium or discount is 20% or more"), id);
    assert.ok(prompt.includes("score the filing at 75 or above so delivery becomes alert"), id);
    assert.ok(prompt.includes("event-driven and potentially volatile, not inherently Positive or Negative"), id);
    assert.ok(prompt.includes("board approval, recommendation, or deal process as a positive or negative signal by itself"), id);
    assert.ok(prompt.includes("Do not treat procedural progress as Positive by default"), id);
    assert.ok(prompt.includes("A reduction in uncertainty is Positive only when the filing shows"), id);
    assert.ok(prompt.includes("Merger Positive/Negative hard rule"), id);
    assert.ok(prompt.includes("Invalid merger Positive points"), id);
    assert.ok(prompt.includes("Invalid merger Negative points"), id);
    assert.ok(prompt.includes("Never put neutral procedural transaction facts in bullish_points or bearish_points"), id);
    assert.ok(prompt.includes("The UI displays these legacy keys as Positive and Negative"), id);
    assert.ok(prompt.includes("Investor-facing field rules apply to analysis_output"), id);
    assert.ok(prompt.includes("quick_take: write one clear sentence under 22 words"), id);
    assert.ok(prompt.includes("summary: write 2-4 short sentences under 100 words total"), id);
    assert.ok(prompt.includes("why_it_matters: write one clear sentence under 28 words"), id);
    assert.ok(prompt.includes("score_reason: write one sentence under 14 words"), id);
    assert.ok(prompt.includes("Positive: include up to 3 items through analysis_output.bullish_points"), id);
    assert.ok(prompt.includes("Each Positive item must be under 18 words"), id);
    assert.ok(prompt.includes("Negative: include up to 3 items through analysis_output.bearish_points"), id);
    assert.ok(prompt.includes("Each Negative item must be under 18 words"), id);
    assert.ok(prompt.includes("key_evidence: include up to 3 items"), id);
    assert.ok(prompt.includes("Each item must be under 22 words"), id);
    assert.ok(prompt.includes("what_to_watch_next: include up to 3 items"), id);
    assert.ok(prompt.includes("Each what_to_watch_next item must be under 18 words"), id);
    assert.ok(prompt.includes("Do not use subjectless fragments in user-facing fields"), id);
    assert.ok(prompt.includes("Do not force three items when only one or two source-backed points exist"), id);
    assert.ok(prompt.includes("Do not repeat the same fact across bullish_points, bearish_points, and key_evidence"), id);
    assert.ok(prompt.includes("Writing style:"), id);
    assert.ok(prompt.includes("Use plain investor language. Rewrite SEC/legal phrasing"), id);
    assert.ok(prompt.includes("Do not copy filing jargon when a simpler phrase is possible"), id);
    assert.ok(prompt.includes("Keep each point self-contained and easy to understand"), id);
    assert.ok(prompt.includes("Avoid legalistic fragments"), id);
    if (expected.fixture_expected.market_context_needed) {
      assert.ok(fixture.market_context, id);
      assert.ok(prompt.includes("shares_outstanding"), id);
    }

    if (id === "amendment-routine") {
      assert.ok(expected.fixture_expected.integration_notes.some((note) => note.includes("no LLM analysis needed")), id);
    }
  }
}

function fixtureIds(): string[] {
  return readdirSync(join(roomDir, "fixtures"))
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => fileName.replace(/\.json$/, ""))
    .sort();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
