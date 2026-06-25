import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { s1F1Adapter } from "./adapter.ts";
import { parseS1F1Filing } from "./parser.ts";
import { buildS1F1RouterPrompt, selectPreliminaryS1F1Route } from "./routerPrompt.ts";
import { APPROVED_SEC_EVENT_TYPES, type S1F1ParserInput } from "./types.ts";

const ROOM_URL = new URL("./", import.meta.url);
const FIXTURE_NAMES = [
  "edgar-cava-s1-ipo",
  "edgar-reddit-s1a-pricing",
  "edgar-arm-f1a-ads-ipo",
  "edgar-spirit-posam-deregistration",
  "edgar-liberty-f1mef-rule462b",
  "edgar-medline-s1mef-rule462b",
] as const;

interface FixtureFile {
  input: S1F1ParserInput;
  expected: {
    event_type: string;
    deterministic: boolean;
  };
}

function loadFixture(name: string): FixtureFile {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, ROOM_URL), "utf8")) as FixtureFile;
}

describe("S-1/F-1 router prompt", () => {
  it("lists only the approved SEC event types", () => {
    const parserOutput = parseS1F1Filing(loadFixture("edgar-reddit-s1a-pricing").input);
    const prompt = buildS1F1RouterPrompt(parserOutput);

    for (const eventType of APPROVED_SEC_EVENT_TYPES) {
      assert.match(prompt, new RegExp(`^- ${eventType}$`, "m"), `prompt is missing ${eventType}`);
    }

    for (const disallowed of ["ipo", "offering", "clinical_update", "dilution", "bankruptcy"]) {
      assert.doesNotMatch(prompt, new RegExp(`^- ${disallowed}$`, "m"), `prompt should not list ${disallowed}`);
    }
  });

  it("uses compact classifier input instead of full raw filing text and carries display routing", () => {
    const parserOutput = parseS1F1Filing(loadFixture("edgar-cava-s1-ipo").input);
    const prompt = buildS1F1RouterPrompt(parserOutput);
    const route = selectPreliminaryS1F1Route(parserOutput);

    assert.ok(prompt.includes("Compact router/classifier input"));
    assert.ok(prompt.includes("cleaned_source_blocks"));
    assert.ok(prompt.includes("attachment_inventory"));
    assert.ok(prompt.includes("display_type"));
    assert.ok(prompt.includes("analysis_llm_needed"));
    assert.doesNotMatch(prompt, /"selected_route_defaults"/);
    assert.doesNotMatch(prompt, /"selected_evidence"/);
    assert.doesNotMatch(prompt, /"facts"/);
    assert.doesNotMatch(prompt, /"extraction_summary"/);
    assert.equal(route.event_type, "other");
    assert.equal(route.display_type, "generic");
    assert.equal(route.display_version, "s1-f1-display-v1");
    assert.equal(route.analysis_llm_needed, true);
    assert.ok(prompt.length < JSON.stringify(parserOutput, null, 2).length);
  });

  it("exposes the live integration adapter entrypoints and normalizes runtime input", () => {
    const parserOutput = s1F1Adapter.parse({
      formType: "S-1",
      accessionNumber: "0000000000-26-000001",
      primaryDocumentText: "This is our initial public offering. No public market currently exists for our common stock.",
      ticker: "TEST",
      companyName: "Test IPO Inc.",
      attachments: [
        {
          filename: "ex107.htm",
          description: "Filing Fee Table",
          text: "Calculation of Filing Fee Tables",
        },
      ],
    });

    assert.equal(s1F1Adapter.key, "sec-s1-f1");
    assert.equal(s1F1Adapter.parserGroup, "s1-f1");
    assert.equal(s1F1Adapter.analysisMode, "analysis_only");
    assert.deepEqual([...s1F1Adapter.supportedForms], ["S-1", "S-1/A", "F-1", "F-1/A", "S-1MEF", "F-1MEF", "POS AM"]);
    assert.equal("selectRoute" in s1F1Adapter, false);
    assert.equal("buildDisplayPayload" in s1F1Adapter, false);
    assert.equal(typeof s1F1Adapter.buildAnalysisPrompt, "function");
    assert.equal(parserOutput.accessionNumber, "0000000000-26-000001");
    assert.equal(parserOutput.facts.ticker, "TEST");
    assert.equal(parserOutput.raw.attachmentNames[0], "ex107.htm");
    assert.ok(parserOutput.raw.cleanedSourceBlocks?.some((block) => block.text.includes("initial public offering")));
  });

  for (const name of FIXTURE_NAMES) {
    it(`passes ${name} source blocks to the router without parser classification`, () => {
      const fixture = loadFixture(name);
      const parserOutput = parseS1F1Filing(fixture.input);
      const route = selectPreliminaryS1F1Route(parserOutput);

      assert.equal(route.event_type, "other");
      assert.equal(route.preliminary_action, "send_to_analysis_llm");
      assert.equal(route.analysis_llm_needed, true);
      assert.ok(route.display_type);
      assert.equal(route.display_version, "s1-f1-display-v1");
      assert.ok((parserOutput.raw.cleanedSourceBlocks?.length ?? 0) > 0);
    });
  }
});
