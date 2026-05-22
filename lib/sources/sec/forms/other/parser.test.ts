import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SecFormParserInput } from "../common";
import { parseSecOtherFiling } from "./parser";

const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "other", "fixtures");

const administrative = parseSecOtherFiling(readFixture("administrative-other.json"));
assert.equal(administrative.parserGroup, "other");
assert.equal(administrative.facts.reason_not_dedicated.value, "explicit_other_sec_filing_fallback");
assert.equal(administrative.facts.issuer.ticker, "ABCD");
assert.equal(administrative.facts.recognized_keywords.length, 0);

const listingRisk = parseSecOtherFiling(readFixture("listing-risk-other.json"));
assert.equal(listingRisk.parserGroup, "other");
assert.ok(listingRisk.signals?.includes("candidate_event_type:listing_risk"));
assert.ok(listingRisk.facts.recognized_keywords.some((signal) => signal.event_type_hint === "listing_risk"));
assert.ok(listingRisk.facts.date_candidates.some((candidate) => candidate.role === "deadline"));
assert.ok(listingRisk.facts.value_candidates.some((candidate) => candidate.kind === "price" || candidate.kind === "percent") === false);

console.log("sec other parser fixtures passed");

function readFixture(name: string): SecFormParserInput {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as SecFormParserInput;
}
