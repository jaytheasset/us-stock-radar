import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse424bFiling } from "./parser";
import type { Sec424bFixtureInput, Sec424bParserOutput } from "./types";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "424b");
const fixturesDir = join(roomDir, "fixtures");

const forbiddenParserJudgmentKeys = new Set([
  "analysis_output",
  "analysis_action",
  "delivery_level",
  "event_title",
  "event_type",
  "expected_delivery_level",
  "expected_impact",
  "quick_take",
  "score",
  "score_reason",
  "signal",
]);

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function fixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""))
    .sort();
}

function findForbiddenKeys(value: unknown, path = "parser_output"): string[] {
  if (value == null || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findForbiddenKeys(entry, `${path}[${index}]`));
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const keyPath = `${path}.${key}`;
    const current = forbiddenParserJudgmentKeys.has(key) ? [keyPath] : [];
    return [...current, ...findForbiddenKeys(child, keyPath)];
  });
}

function signalNames(output: Sec424bParserOutput): string[] {
  return output.signals.map((signal) => signal.name);
}

describe("424B parser validation guardrails", () => {
  it("keeps parser output free of final event, score, delivery, and analysis fields", () => {
    for (const name of fixtureNames()) {
      const fixture = loadJson<Sec424bFixtureInput>(join(fixturesDir, `${name}.json`));
      const output = parse424bFiling(fixture);

      assert.deepEqual(findForbiddenKeys(output), [], `${name} parser output contains judgment keys`);
    }
  });

  it("preserves multiple source signals without making a deterministic final choice", () => {
    const fixture = loadJson<Sec424bFixtureInput>(join(fixturesDir, "ambiguous-risk-supplement.json"));
    const output = parse424bFiling(fixture);
    const names = signalNames(output);

    assert.ok(names.includes("fda_clinical"));
    assert.ok(names.includes("listing_risk"));
    assert.equal(output.raw.deterministicCandidate, null);
  });

  it("keeps structured-note reference assets separate from issuer identity", () => {
    const fixture = loadJson<Sec424bFixtureInput>(join(fixturesDir, "structured-note-pdf.json"));
    const output = parse424bFiling(fixture);
    const facts = output.facts as {
      issuer?: { ticker?: string | null };
      structuredNoteTerms?: { referenceTicker?: string | null };
      flags?: { structuredNote?: boolean; pdfTableFragility?: boolean };
    };

    assert.equal(facts.issuer?.ticker, null);
    assert.equal(facts.structuredNoteTerms?.referenceTicker, "TSLA");
    assert.equal(facts.flags?.structuredNote, true);
    assert.equal(facts.flags?.pdfTableFragility, true);
    assert.ok(output.warnings.includes("PDF text-layer page markers detected; table pairings may require review."));
  });

  it("does not turn non-common security variants into deterministic analysis decisions", () => {
    for (const name of [
      "final-preferred-depositary",
      "multi-leg-warrant-offering",
      "rights-offering",
      "structured-note-pdf",
    ]) {
      const fixture = loadJson<Sec424bFixtureInput>(join(fixturesDir, `${name}.json`));
      const output = parse424bFiling(fixture);

      assert.equal(output.raw.deterministicCandidate, null, `${name} should remain parser facts only`);
    }
  });

  it("keeps variant-specific raw buckets empty when that variant is not present", () => {
    const primary = parse424bFiling(
      loadJson<Sec424bFixtureInput>(join(fixturesDir, "primary-high-dilution.json")),
    );
    const primaryFacts = primary.facts as {
      preferredTerms?: Record<string, unknown>;
      rightsOfferingTerms?: Record<string, unknown>;
      structuredNoteTerms?: Record<string, unknown>;
      multiLegWarrantTerms?: Record<string, unknown>;
    };

    assertAllNullish(primaryFacts.preferredTerms, ["depositaryShareCount", "liquidationPreferencePerPreferredShare"]);
    assertAllNullish(primaryFacts.rightsOfferingTerms, ["rightsCount", "sharesIssuable", "rightsNeededPerShare"]);
    assertAllNullish(primaryFacts.structuredNoteTerms, ["principalAmount", "referenceAsset", "referenceTicker"]);
    assertAllNullish(primaryFacts.multiLegWarrantTerms, [
      "commonSharesOffered",
      "preFundedWarrants",
      "commonWarrants",
      "placementAgentWarrants",
    ]);

    const preferred = parse424bFiling(
      loadJson<Sec424bFixtureInput>(join(fixturesDir, "final-preferred-depositary.json")),
    );
    const preferredFacts = preferred.facts as {
      offeringTerms?: Record<string, unknown>;
      rightsOfferingTerms?: Record<string, unknown>;
      structuredNoteTerms?: Record<string, unknown>;
      multiLegWarrantTerms?: Record<string, unknown>;
    };

    assertAllNullish(preferredFacts.offeringTerms, ["sharesOffered", "pricePerShare", "maxOfferingAmount"]);
    assertAllNullish(preferredFacts.rightsOfferingTerms, ["rightsCount", "sharesIssuable"]);
    assertAllNullish(preferredFacts.structuredNoteTerms, ["principalAmount", "referenceTicker"]);
    assertAllNullish(preferredFacts.multiLegWarrantTerms, ["preFundedWarrants", "commonWarrants"]);
  });

  it("captures minimum required raw fields for each representative structure", () => {
    const primary = factsFor("primary-high-dilution");
    assert.deepEqual(pick(primary.offeringTerms, ["sharesOffered", "pricePerShare", "grossProceeds", "netProceeds"]), {
      sharesOffered: 30000000,
      pricePerShare: 1,
      grossProceeds: 30000000,
      netProceeds: 27600000,
    });

    const resale = factsFor("resale-overhang");
    assert.deepEqual(pick(resale.offeringTerms, ["sellingStockholderShares", "noCompanyProceeds"]), {
      sellingStockholderShares: 12500000,
      noCompanyProceeds: true,
    });

    const atm = factsFor("atm-market-context");
    assert.deepEqual(pick(atm.offeringTerms, ["maxOfferingAmount", "atTheMarket"]), {
      maxOfferingAmount: 100000000,
      atTheMarket: true,
    });

    const preferred = factsFor("final-preferred-depositary");
    assert.deepEqual(
      pick(preferred.preferredTerms, [
        "depositaryShareCount",
        "depositaryFraction",
        "liquidationPreferencePerPreferredShare",
        "liquidationPreferencePerDepositaryShare",
        "dividendRatePercent",
        "redemptionDate",
        "proposedListingSymbol",
      ]),
      {
        depositaryShareCount: 12000000,
        depositaryFraction: "1/1000",
        liquidationPreferencePerPreferredShare: 25000,
        liquidationPreferencePerDepositaryShare: 25,
        dividendRatePercent: 7,
        redemptionDate: "June 15, 2031",
        proposedListingSymbol: "AHLPRD",
      },
    );

    const rights = factsFor("rights-offering");
    assert.deepEqual(
      pick(rights.rightsOfferingTerms, [
        "rightsCount",
        "sharesIssuable",
        "rightsNeededPerShare",
        "recordDate",
        "expirationDate",
        "transferable",
        "overSubscriptionPrivilege",
        "rightsSymbol",
        "estimatedProceeds",
      ]),
      {
        rightsCount: 10000000,
        sharesIssuable: 3333333,
        rightsNeededPerShare: 3,
        recordDate: "June 2, 2026",
        expirationDate: "June 30, 2026",
        transferable: true,
        overSubscriptionPrivilege: true,
        rightsSymbol: "BRW RT",
        estimatedProceeds: 48000000,
      },
    );

    const warrant = factsFor("multi-leg-warrant-offering");
    assert.deepEqual(
      pick(warrant.multiLegWarrantTerms, [
        "commonSharesOffered",
        "preFundedWarrants",
        "commonWarrants",
        "placementAgentWarrants",
        "preFundedWarrantPurchasePrice",
        "preFundedWarrantExercisePrice",
        "commonWarrantExercisePrice",
        "placementAgentWarrantExercisePrice",
        "ownershipCapPercent",
      ]),
      {
        commonSharesOffered: 300000,
        preFundedWarrants: 973886,
        commonWarrants: 1273886,
        placementAgentWarrants: 63694,
        preFundedWarrantPurchasePrice: 3.92499,
        preFundedWarrantExercisePrice: 0.00001,
        commonWarrantExercisePrice: 3.8,
        placementAgentWarrantExercisePrice: 4.3175,
        ownershipCapPercent: 4.99,
      },
    );

    const note = factsFor("structured-note-pdf");
    assert.deepEqual(
      pick(note.structuredNoteTerms, [
        "issuer",
        "guarantor",
        "principalAmount",
        "referenceAsset",
        "referenceTicker",
        "tradeDate",
        "originalIssueDate",
        "finalValuationDate",
        "maturityDate",
        "contingentCouponRatePercent",
        "barrierPercent",
        "cusip",
        "isin",
        "listed",
      ]),
      {
        issuer: "Nomura America Finance, LLC",
        guarantor: "Nomura Holdings, Inc",
        principalAmount: 929000,
        referenceAsset: "Common Stock of Tesla, Inc",
        referenceTicker: "TSLA",
        tradeDate: "May 18, 2026",
        originalIssueDate: "May 21, 2026",
        finalValuationDate: "May 17, 2028",
        maturityDate: "May 22, 2028",
        contingentCouponRatePercent: 14.25,
        barrierPercent: 60,
        cusip: "65539XXY7",
        isin: "US65539XXY71",
        listed: false,
      },
    );
  });

  it("warns on preliminary blanks instead of inferring missing final terms", () => {
    const output = parse424bFiling({
      formType: "424B5",
      accessionNumber: "0000000000-26-009999",
      issuer: {
        name: "Placeholder Bancorp, Inc.",
        ticker: "PHBC",
        exchange: "NYSE",
      },
      filingText:
        "Subject to Completion Preliminary Prospectus Supplement Placeholder Bancorp, Inc. [●] Depositary Shares. Each depositary share represents a 1/40th interest in Series A Preferred Stock. Dividends will accrue at a rate of [●]% per annum. The liquidation preference will be $1,000 per preferred share, equivalent to $25 per depositary share.",
    });
    const facts = output.facts as {
      preferredTerms?: {
        depositaryShareCount?: number | null;
        dividendRatePercent?: number | null;
        liquidationPreferencePerPreferredShare?: number | null;
      };
      flags?: { variableOrMissingTerms?: boolean };
    };

    assert.equal(facts.flags?.variableOrMissingTerms, true);
    assert.equal(facts.preferredTerms?.depositaryShareCount, null);
    assert.equal(facts.preferredTerms?.dividendRatePercent, null);
    assert.equal(facts.preferredTerms?.liquidationPreferencePerPreferredShare, 1000);
    assert.ok(
      output.warnings.includes(
        "Preliminary, blank, or formula-based terms detected; parser should not infer missing final values.",
      ),
    );
  });
});

function assertAllNullish(record: Record<string, unknown> | undefined, keys: string[]): void {
  for (const key of keys) {
    assert.equal(record?.[key] ?? null, null, `${key} should not be populated for this fixture`);
  }
}

function factsFor(name: string): Record<string, Record<string, unknown>> {
  const fixture = loadJson<Sec424bFixtureInput>(join(fixturesDir, `${name}.json`));
  return parse424bFiling(fixture).facts as Record<string, Record<string, unknown>>;
}

function pick(record: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, record?.[key] ?? null]));
}
