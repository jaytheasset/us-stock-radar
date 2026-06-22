import assert from "node:assert/strict";

import {
  buildSecInvestableUniverseSkipAnalysis,
  evaluateSecInvestableUniverse,
} from "@/lib/ai/secInvestableUniverseGate";
import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";

function input(packageFields: Record<string, unknown>): SecFilingAnalysisInput {
  return {
    filing_package: {
      form_type: "DEF 14A",
      title: "",
      company_name: "",
      llm_text: "",
      ...packageFields,
    },
  };
}

function assertSkipped(name: string, filingPackage: Record<string, unknown>) {
  const result = evaluateSecInvestableUniverse(input(filingPackage));
  assert.ok(result, `${name} should be skipped`);
  assert.equal(result.action, "skip_analysis");
  assert.equal(result.gate, "sec_investable_universe");
  assert.ok(result.evidence.length > 0, `${name} should include evidence`);
  return result;
}

function assertKept(name: string, filingPackage: Record<string, unknown>) {
  const result = evaluateSecInvestableUniverse(input(filingPackage));
  assert.equal(result, null, `${name} should stay in analysis universe`);
}

const valuedTrustGate = assertSkipped("proxy trust with no ticker", {
  form_type: "DEF 14A",
  title: "DEF 14A - VALUED ADVISERS TRUST (CIK 0001437249)",
  company_name: "VALUED ADVISERS TRUST",
  llm_text: "The registrant is a series trust and registered investment company.",
});
assert.equal(valuedTrustGate.confidence, "high");

assertSkipped("green century fund with no ticker", {
  form_type: "DEFA14A",
  title: "DEFA14A - GREEN CENTURY FUNDS (CIK 0000877232)",
  company_name: "GREEN CENTURY FUNDS",
  llm_text: "Supplemental proxy material for a mutual fund.",
});

assertSkipped("non-traded strategic capital vehicle with no ticker", {
  form_type: "DEF 14A",
  title: "DEF 14A - CNL Strategic Capital, LLC (CIK 0001684682)",
  company_name: "CNL Strategic Capital, LLC",
  llm_text: "The company is a non-traded business development company.",
});

assertSkipped("NAV tender fund with no ticker", {
  form_type: "SC TO-I",
  title: "SC TO-I - Oxford Park Income Fund, Inc.",
  company_name: "Oxford Park Income Fund, Inc.",
  llm_text:
    "Issuer tender offer. Shares are not listed on any securities exchange. Purchase Size is up to 5% of the Fund's net asset value as of the prior calendar quarter end. Each Share will be purchased at net asset value per Share calculated as of the Valuation Date.",
});

assertKept("listed closed-end fund proxy with ticker", {
  form_type: "DEF 14A",
  title: "DEF 14A - Eaton Vance California Municipal Income Trust (CEV)",
  company_name: "Eaton Vance California Municipal Income Trust",
  tickers: [{ ticker: "CEV", exchange: "NYSE" }],
  llm_text: "Closed-end fund annual meeting.",
});

assertKept("operating company proxy with ticker", {
  form_type: "DEFA14A",
  title: "DEFA14A - EXACT SCIENCES CORP (EXAS)",
  company_name: "EXACT SCIENCES CORP",
  primary_ticker: { ticker: "EXAS", exchange: "NASDAQ" },
  llm_text: "Supplemental proxy material.",
});

assertKept("SPAC proxy without ticker", {
  form_type: "PRE 14A",
  title: "PRE 14A - Piermont Valley Acquisition Corp",
  company_name: "Piermont Valley Acquisition Corp",
  llm_text:
    "The special purpose acquisition company is seeking shareholder approval for a business combination and related proposals.",
});

assertKept("IPO candidate without ticker", {
  form_type: "S-1",
  title: "S-1 - Example IPO Holdings Inc.",
  company_name: "Example IPO Holdings Inc.",
  llm_text: "The registrant intends to list its common stock on Nasdaq.",
});

assertSkipped("ownership filing without ticker", {
  form_type: "4",
  title: "Form 4 insider ownership filing",
  company_name: "Example Issuer",
  llm_text: "Non-derivative transaction code P.",
});

assertSkipped("cash common-stock tender without ticker", {
  form_type: "SC TO-I",
  title: "SC TO-I - Example Corp tender offer",
  company_name: "Example Corp",
  llm_text:
    "The issuer is offering to purchase shares of common stock at a purchase price of $10.00 per share in cash.",
});

assertSkipped("SC13 filing with unresolved ticker", {
  form_type: "SCHEDULE 13G/A",
  title: "Eventbrite, Inc. files SCHEDULE 13G/A",
  company_name: "Eventbrite, Inc.",
  llm_text: "The reporting persons report zero shares and zero percent beneficial ownership.",
});

assertKept("de-SPAC transaction without resolved current ticker", {
  form_type: "S-4/A",
  title: "S-4/A - Example Acquisition Corp",
  company_name: "Example Acquisition Corp",
  llm_text: "The special purpose acquisition company disclosed a business combination and expected ticker change.",
});

const skipAnalysis = buildSecInvestableUniverseSkipAnalysis(
  input({
    form_type: "SC TO-I",
    title: "SC TO-I - Oxford Park Income Fund, Inc.",
    company_name: "Oxford Park Income Fund, Inc.",
    llm_text: "NAV repurchase offer for shares of beneficial interest.",
  }),
  assertSkipped("skip analysis builder input", {
    form_type: "SC TO-I",
    title: "SC TO-I - Oxford Park Income Fund, Inc.",
    company_name: "Oxford Park Income Fund, Inc.",
    llm_text: "NAV repurchase offer for shares of beneficial interest.",
  }),
);
assert.equal(skipAnalysis.analysis_action, "skip_analysis");
assert.equal(skipAnalysis.skip_gate, "sec_investable_universe");
assert.equal(skipAnalysis.score, 0);
assert.deepEqual(skipAnalysis.bullish_points, []);
assert.deepEqual(skipAnalysis.bearish_points, []);

console.log("secInvestableUniverseGate tests passed");
