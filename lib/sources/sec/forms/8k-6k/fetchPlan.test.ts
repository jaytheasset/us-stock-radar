import assert from "node:assert/strict";

import { matchesSecFormFetchRule } from "../common/fetchPlan";
import { decodeSecHtmlEntities } from "../../htmlEntities";
import { sec8k6kFetchPlan } from "./fetchPlan";

const auditorLetterRule = sec8k6kFetchPlan.rules.find((rule) => rule.id === "auditor-letters");
const pressReleaseRule = sec8k6kFetchPlan.rules.find((rule) => rule.id === "press-release-or-operating-update");

assert.ok(auditorLetterRule, "8-K/6-K fetch plan should include an auditor-letter rule");
assert.ok(pressReleaseRule, "8-K/6-K fetch plan should include a press-release rule");
assert.equal(
  matchesSecFormFetchRule(
    {
      type: "EX-16.1",
      description: "Letter from former independent registered public accounting firm",
      document: "exhibit-16.htm",
    },
    auditorLetterRule,
  ),
  true,
);
assert.equal(decodeSecHtmlEntities("LYTENAVA&#8482;"), "LYTENAVA\u2122");
assert.equal(decodeSecHtmlEntities("LYTENAVA&trade;"), "LYTENAVA\u2122");
assert.equal(decodeSecHtmlEntities("LYTENAVA\u00e2\u0084\u00a2"), "LYTENAVA\u2122");
assert.equal(
  matchesSecFormFetchRule(
    {
      type: "EX-99.1",
      description: "Earnings release",
      document: "earnings.htm",
    },
    auditorLetterRule,
  ),
  false,
);
assert.equal(
  matchesSecFormFetchRule(
    {
      type: "GRAPHIC",
      description: null,
      document: "fdaapprovalpressrelease_001.jpg",
      url: "https://www.sec.gov/Archives/edgar/data/example/fdaapprovalpressrelease_001.jpg",
    },
    pressReleaseRule,
  ),
  false,
);
assert.equal(
  matchesSecFormFetchRule(
    {
      type: "EX-99.1",
      description: "FDA approval press release",
      document: "fdaapprovalpressrelease.htm",
      url: "https://www.sec.gov/Archives/edgar/data/example/fdaapprovalpressrelease.htm",
    },
    pressReleaseRule,
  ),
  true,
);

console.log("8-K/6-K fetch plan tests passed");
