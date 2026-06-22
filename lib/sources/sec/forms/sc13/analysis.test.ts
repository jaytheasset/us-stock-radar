import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "./testExpect";
import { buildSc13AnalysisPrompt, buildSc13DeterministicResult } from "./analysisPrompt";
import { parseSc13Filing } from "./parser";
import {
  APPROVED_EVENT_TYPES,
  type DeliveryLevel,
  type Sc13Fixture,
  type Sc13RouteDecision,
} from "./types";

const roomDir = dirname(fileURLToPath(import.meta.url));
const fixtureNames = [
  "passive-13g",
  "activist-13d",
  "material-13da",
  "routine-13ga",
  "market-context-13d",
  "institutional-base-13g",
  "exit-13ga",
  "sales-plan-13da",
];
const requiredTopLevelKeys = ["parser_output", "analysis_output", "display_payload", "fixture_expected"];
const displayTypes = ["generic", "offering_terms", "candidate_special"];

function loadJson<T>(folder: "fixtures" | "expected", name: string, suffix = ""): T {
  return JSON.parse(readFileSync(join(roomDir, folder, `${name}${suffix}.json`), "utf8")) as T;
}

function parseFixture(name: string) {
  const fixture = loadJson<Sc13Fixture>("fixtures", name);
  return {
    fixture,
    parserOutput: parseSc13Filing(fixture.filing, {
      marketContext: fixture.market_context ?? null,
    }),
  };
}

function deliveryFromScore(score: number): DeliveryLevel {
  if (score < 50) return "archive";
  if (score < 75) return "feed";
  return "alert";
}

describe("SC 13 analysis prompt and expected JSON", () => {
  it.each(fixtureNames)("keeps %s expected output in the required JSON shape", (name) => {
    const fixture = loadJson<Sc13Fixture>("fixtures", name);
    const expected = loadJson<Record<string, any>>("expected", name, ".expected");

    for (const key of requiredTopLevelKeys) {
      expect(expected).toHaveProperty(key);
    }

    expect(expected.parser_output.parserGroup).toBe("sc13");
    expect(expected.parser_output.isSupported).toBe(true);
    expect(APPROVED_EVENT_TYPES).toContain(expected.analysis_output.event_type);
    expect(expected.analysis_output.event_type).toBe(fixture.expected?.event_type);
    expect(displayTypes).toContain(expected.display_payload.display_type);
    expect(expected.fixture_expected.expected_delivery_level).toBe(deliveryFromScore(expected.analysis_output.score));
    expect(expected.analysis_output.score).toBeGreaterThanOrEqual(0);
    expect(expected.analysis_output.score).toBeLessThanOrEqual(100);
  });

  it.each(["passive-13g", "routine-13ga", "exit-13ga"])("does not build parser-only archive output for %s", (name) => {
    const { parserOutput } = parseFixture(name);
    const result = buildSc13DeterministicResult(parserOutput);

    expect(result).toBeNull();
  });

  it.each(["passive-13g", "routine-13ga", "exit-13ga", "activist-13d", "material-13da", "market-context-13d", "sales-plan-13da"])("builds an analysis prompt for %s", (name) => {
    const { fixture, parserOutput } = parseFixture(name);
    const routeDecision: Sc13RouteDecision = {
      event_type: fixture.expected?.event_type ?? "other",
      preliminary_action: fixture.expected?.score_band === "alert" ? "alert" : "needs_analysis",
      display_type: "generic",
      display_version: "sc13-ownership-v1",
      requires_analysis_llm: true,
      reason: "Fixture expects LLM analysis for material SC 13 facts.",
      confidence: "medium",
      deterministic: false,
    };
    const prompt = buildSc13AnalysisPrompt(parserOutput, routeDecision, {
      marketContext: fixture.market_context ?? null,
    });

    expect(prompt).toContain("Return JSON only");
    expect(prompt).toContain("delivery_level is derived from score only");
    expect(prompt).toContain("Analyze the current filing first");
    expect(prompt).toContain("cleaned_source_blocks:");
    expect(prompt).toContain("There is no router LLM for this room");
    expect(prompt).toContain("Build display_payload directly from cleaned_source_blocks");
    expect(prompt).toContain("Choose exactly one approved event_type");
    expect(prompt).toContain("SC13 analysis principles");
    expect(prompt).toContain("Core question");
    expect(prompt).toContain("Direct action matters most");
    expect(prompt).toContain("Positive/Negative discipline");
    expect(prompt).toContain("Ownership alignment is not Positive by itself");
    expect(prompt).toContain("bullish_points are displayed as Positive");
    expect(prompt).toContain("insider/family/control-holder ownership");
    expect(prompt).toContain("SC13 directional point rules");
    expect(prompt).toContain("meaningful change 2.0-4.99pp");
    expect(prompt).toContain("large change 5.0pp+");
    expect(prompt).toContain("block sale, registered offering sale, or full exit");
    expect(prompt).toContain("generic float mechanics");
    expect(prompt).toContain("contextual facts");
    expect(prompt).toContain("Prior 13D history alone is not Negative");
    expect(prompt).toContain("Passive 13G ownership bands");
    expect(prompt).not.toContain("selected_display_payload:");
    expect(prompt).not.toContain("route_decision:");
    expect(prompt).not.toContain("parser_output:");
    expect(prompt).toContain("parent_filing_context:");
    expect(prompt).toContain("Do not call live FMP");
    expect(prompt).toContain(fixture.expected?.event_type);
    expect(prompt).not.toContain('"facts"');
    expect(prompt).not.toContain('"parserGroup"');
    expect(prompt).not.toContain("fixture_expected");
  });
});
