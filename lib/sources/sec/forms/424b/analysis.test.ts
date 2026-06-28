import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build424bAnalysisPrompt, validate424bRoomResult } from "./analysisPrompt";
import { parse424bFiling } from "./parser";
import {
  APPROVED_424B_EVENT_TYPES,
  type Sec424bFixtureInput,
  type Sec424bRoomResult,
  deriveDeliveryLevel,
} from "./types";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "424b");
const fixturesDir = join(roomDir, "fixtures");
const expectedDir = join(roomDir, "expected");

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function expectedNames(): string[] {
  return readdirSync(expectedDir)
    .filter((file) => file.endsWith(".expected.json"))
    .map((file) => file.replace(/\.expected\.json$/, ""))
    .sort();
}

describe("424B analysis fixtures", () => {
  for (const name of expectedNames()) {
    it(`keeps ${name} in the required output shape`, () => {
      const expected = loadJson<Sec424bRoomResult>(join(expectedDir, `${name}.expected.json`));

      assert.deepEqual(validate424bRoomResult(expected), []);
      assert.ok(APPROVED_424B_EVENT_TYPES.includes(expected.analysis_output.event_type));
      assert.equal(
        deriveDeliveryLevel(expected.analysis_output.score),
        expected.fixture_expected.expected_delivery_level,
      );
      assert.equal(expected.analysis_output.source_group, "filings");
      assert.ok(["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(expected.display_payload.display_type));
      assert.equal(expected.display_payload.display_version, "424b-display-payload-v1");
    });
  }

  it("builds an analysis prompt from cleaned source blocks without a router", () => {
    const fixture = loadJson<Sec424bFixtureInput>(join(fixturesDir, "resale-overhang.json"));
    const parserOutput = parse424bFiling(fixture);
    const prompt = build424bAnalysisPrompt(parserOutput);

    assert.ok(prompt.includes("score below 50 = archive; 50 to 74 = feed; 75 or above = alert"));
    assert.ok(prompt.includes("cleaned_source_blocks"));
    assert.ok(prompt.includes("Do not call live APIs"));
    assert.ok(prompt.includes("Write investor-facing copy only."));
    assert.ok(prompt.includes("There is no 424B router LLM"));
    assert.ok(prompt.includes("Choose the final event_type"));
    assert.ok(prompt.includes("Choose the final display_payload.display_type"));
    assert.ok(prompt.includes("spac_transaction_status"));
    assert.ok(prompt.includes("Use offering_terms when 424B source blocks disclose offering"));
    assert.ok(prompt.includes("Do not use post-offering share count assumptions as actual supply."));
    assert.ok(prompt.includes("Do not describe an ATM program as a resale pool"));
    assert.ok(prompt.includes("offering_details must be an array of { label, value, note? }"));
    assert.ok(prompt.includes("note is also visible under the value"));
    assert.ok(prompt.includes("Do not leave material exceptions or investor-critical caveats only"));
    for (const eventType of APPROVED_424B_EVENT_TYPES) {
      assert.ok(prompt.includes(`- ${eventType}`));
    }
  });
});
