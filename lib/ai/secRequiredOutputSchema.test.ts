import assert from "node:assert/strict";
import { buildSecRequiredOutputSchema } from "./secRequiredOutputSchema";

const schema = buildSecRequiredOutputSchema();
const properties = schema.properties;
const analysisOutput = properties.analysis_output;
const displayPayload = properties.display_payload;
const analysisRequired = analysisOutput.required as readonly string[];
const displayRequired = displayPayload.required as readonly string[];

assert.deepEqual(schema.required, ["analysis_output", "display_payload"]);
assert.ok(!schema.required.includes("parser_output"));

for (const field of [
  "source_group",
  "market_scope",
  "event_type",
  "event_title",
  "primary_ticker",
  "tickers",
  "score",
  "score_reason",
  "signal",
  "quick_take",
  "summary",
  "why_it_matters",
  "bullish_points",
  "bearish_points",
  "key_evidence",
  "what_to_watch_next",
  "confidence",
  "needs_human_review",
]) {
  assert.ok(analysisRequired.includes(field), `analysis_output must require ${field}`);
}

for (const field of ["display_type", "data", "evidence", "notes"]) {
  assert.ok(displayRequired.includes(field), `display_payload must require ${field}`);
}
