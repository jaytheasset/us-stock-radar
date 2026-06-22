import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildS1F1AnalysisPrompt, buildS1F1DisplayPayload, validateS1F1RequiredOutputShape } from "./analysisPrompt.ts";
import { parseS1F1Filing } from "./parser.ts";
import { selectPreliminaryS1F1Route } from "./routerPrompt.ts";
import {
  APPROVED_SEC_EVENT_TYPES,
  deliveryLevelFromScore,
  type S1F1ParserInput,
  type S1F1RequiredOutputJson,
} from "./types.ts";

const ROOM_URL = new URL("./", import.meta.url);
const FIXTURE_NAMES = [
  "edgar-cava-s1-ipo",
  "edgar-reddit-s1a-pricing",
  "edgar-arm-f1a-ads-ipo",
  "edgar-spirit-posam-deregistration",
  "edgar-liberty-f1mef-rule462b",
  "edgar-medline-s1mef-rule462b",
] as const;

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, ROOM_URL), "utf8")) as T;
}

describe("S-1/F-1 analysis output fixtures", () => {
  for (const name of FIXTURE_NAMES) {
    it(`keeps ${name} in the required output JSON shape`, () => {
      const fixture = loadJson<{ expected: { event_type: string; delivery_level: string } }>(`fixtures/${name}.json`);
      const expected = loadJson<S1F1RequiredOutputJson>(`expected/${name}.expected.json`);
      const errors = validateS1F1RequiredOutputShape(expected);

      assert.deepEqual(errors, []);
      assert.equal(expected.analysis_output.event_type, fixture.expected.event_type);
      assert.equal(expected.fixture_expected.expected_delivery_level, fixture.expected.delivery_level);
      assert.ok(APPROVED_SEC_EVENT_TYPES.includes(expected.analysis_output.event_type));
      assert.equal(
        expected.fixture_expected.expected_delivery_level,
        deliveryLevelFromScore(expected.analysis_output.score),
      );
    });
  }

  it("builds an analysis prompt that preserves the parser > router > analysis flow", () => {
    const fixture = loadJson<{ input: S1F1ParserInput }>("fixtures/edgar-reddit-s1a-pricing.json");
    const parserOutput = parseS1F1Filing(fixture.input);
    const route = selectPreliminaryS1F1Route(parserOutput);
    const prompt = buildS1F1AnalysisPrompt(parserOutput, route);

    assert.ok(prompt.includes("Required Output JSON"));
    assert.ok(prompt.includes("S-1 / F-1, S-1/A / F-1/A"));
    assert.ok(prompt.includes("Do not call live FMP"));
    assert.ok(prompt.includes("Do not write UI instructions"));
    assert.ok(prompt.includes("Cleaned source input"));
    assert.ok(prompt.includes("cleaned_source_blocks"));
    assert.ok(prompt.includes("Do not use parser-generated facts"));
    assert.ok(!prompt.includes("Parser output:"));
    assert.ok(prompt.includes('"parser_output"'));
    assert.ok(prompt.includes('"analysis_output"'));
    assert.ok(prompt.includes('"display_payload"'));
    assert.ok(prompt.includes('"fixture_expected"'));
  });

  it("builds a versioned display payload before analysis LLM writing", () => {
    const fixture = loadJson<{ input: S1F1ParserInput }>("fixtures/edgar-cava-s1-ipo.json");
    const parserOutput = parseS1F1Filing(fixture.input);
    const route = {
      ...selectPreliminaryS1F1Route(parserOutput),
      event_type: "ipo_listing" as const,
      display_type: "offering_terms" as const,
    };
    const displayPayload = buildS1F1DisplayPayload(parserOutput, route);

    assert.equal(displayPayload.display_type, route.display_type);
    assert.equal(displayPayload.display_version, "s1-f1-display-v1");
    assert.ok("offering" in displayPayload.data);
    assert.ok(Array.isArray(displayPayload.evidence));
  });

  it("does not use SPAC transaction UI for blank-check IPO registration alone", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText:
        "This is the initial public offering of units of a blank check company and special purpose acquisition company. No target company has been selected.",
    });
    const route = selectPreliminaryS1F1Route(parserOutput);
    const displayPayload = buildS1F1DisplayPayload(parserOutput, route);

    assert.equal(route.event_type, "other");
    assert.equal(route.display_type, "generic");
    assert.equal(parserOutput.raw.spacTransactionStatus?.statusDetected, false);
    assert.equal(displayPayload.display_type, "generic");
    assert.ok(parserOutput.raw.cleanedSourceBlocks?.some((block) => block.text.includes("initial public offering")));
  });

  it("passes de-SPAC source text to the router instead of choosing the SPAC transaction UI in the parser", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText:
        "The registration statement relates to a de-SPAC business combination with TargetCo, Inc. The target company is TargetCo, Inc. The expected ticker will be TGTX. The redemption rate was 82%. The minimum cash condition was waived. PIPE financing and a backstop are in place. The expected closing date is June 30, 2026. The ticker change date is July 1, 2026. Trust cash before redemptions was $250 million and trust cash after redemptions was $45 million. Redemption price was $10.50 per share. Public shares remaining were 4,500,000.",
    });
    const route = selectPreliminaryS1F1Route(parserOutput);
    const displayPayload = buildS1F1DisplayPayload(parserOutput, route);

    assert.equal(route.event_type, "other");
    assert.equal(route.display_type, "generic");
    assert.equal(displayPayload.display_type, "generic");
    assert.ok(parserOutput.raw.cleanedSourceBlocks?.some((block) => block.text.includes("TargetCo, Inc")));
    assert.ok(parserOutput.raw.cleanedSourceBlocks?.some((block) => block.text.includes("minimum cash condition")));
  });

  it("rejects analysis output that substitutes a different primary ticker", () => {
    const expected = loadJson<S1F1RequiredOutputJson>("expected/edgar-reddit-s1a-pricing.expected.json");
    const changed: S1F1RequiredOutputJson = {
      ...expected,
      analysis_output: {
        ...expected.analysis_output,
        primary_ticker: {
          ...expected.analysis_output.primary_ticker,
          ticker: "WRONG",
        },
        tickers: ["WRONG"],
      },
    };

    const errors = validateS1F1RequiredOutputShape(changed);
    assert.ok(errors.includes("analysis_output.primary_ticker.ticker must match parser_output.facts.ticker."));
    assert.ok(errors.includes("analysis_output.tickers must include parser_output.facts.ticker."));
  });
});
