import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "./testExpect";
import { parseSc13Filing } from "./parser";
import { buildSc13RouterPrompt, getSc13DeterministicRoute } from "./routerPrompt";
import { APPROVED_EVENT_TYPES, type Sc13Fixture } from "./types";

const roomDir = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): Sc13Fixture {
  return JSON.parse(readFileSync(join(roomDir, "fixtures", `${name}.json`), "utf8")) as Sc13Fixture;
}

function parseFixture(name: string) {
  const fixture = loadFixture(name);
  return {
    fixture,
    parserOutput: parseSc13Filing(fixture.filing, {
      marketContext: fixture.market_context ?? null,
    }),
  };
}

describe("SC 13 router prompt", () => {
  it.each(["passive-13g", "routine-13ga", "institutional-base-13g", "exit-13ga", "ownership-only-13da"])(
    "does not return deterministic archive routing for %s",
    (name) => {
    const { parserOutput } = parseFixture(name);
    const route = getSc13DeterministicRoute(parserOutput);

    expect(route).toBeNull();
    },
  );

  it.each(["activist-13d", "material-13da", "market-context-13d", "sales-plan-13da", "substantive-item6-13g", "litigation-13d"])(
    "routes %s to LLM analysis prompt",
    (name) => {
    const { fixture, parserOutput } = parseFixture(name);
    const prompt = buildSc13RouterPrompt(parserOutput, {
      marketContext: fixture.market_context ?? null,
    });

    expect(getSc13DeterministicRoute(parserOutput)).toBeNull();
    for (const eventType of APPROVED_EVENT_TYPES) {
      expect(prompt).toContain(eventType);
    }
    expect(prompt).toContain("Return only JSON");
    expect(prompt).toContain("Do not call live market data");
    expect(prompt).toContain("cleaned_source_blocks_input:");
    expect(prompt).toContain("SC13 no longer uses a router LLM");
    expect(prompt).toContain("No deterministic route is available for SC13");
    expect(prompt).toContain("cleaned_source_blocks");
    expect(prompt).not.toContain("compact_router_input:");
    expect(prompt).not.toContain('"facts"');
    expect(prompt).not.toContain('"classificationHandoff"');
    expect(prompt).not.toContain("parser_output:");
    expect(prompt).toContain(fixture.expected?.event_type);
    },
  );

  it("includes fixture market context only when supplied by JSON", () => {
    const { fixture, parserOutput } = parseFixture("market-context-13d");
    const prompt = buildSc13RouterPrompt(parserOutput, {
      marketContext: fixture.market_context ?? null,
    });

    expect(prompt).toContain('"market_cap": 45000000');
    expect(prompt).toContain('"public_float": 31000000');
  });
});
