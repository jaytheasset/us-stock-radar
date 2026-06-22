import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse424bFiling } from "./parser";
import type { Sec424bFixtureInput, Sec424bParserOutput } from "./types";

const realSecFixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "424b", "fixtures", "real-sec");

function loadRealFixture(name: string): Sec424bFixtureInput & {
  sourceUrl: string;
  fixtureSource: { source: string };
} {
  return JSON.parse(readFileSync(join(realSecFixturesDir, `${name}.json`), "utf8").replace(/^\uFEFF/, ""));
}

function allRealFixtureNames(): string[] {
  return readdirSync(realSecFixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""))
    .sort();
}

function facts(output: Sec424bParserOutput): Record<string, Record<string, unknown>> {
  return output.facts as Record<string, Record<string, unknown>>;
}

function assertAllNullish(record: Record<string, unknown> | undefined, keys: string[]): void {
  for (const key of keys) {
    assert.equal(record?.[key] ?? null, null, `${key} should not be populated from this real SEC fixture`);
  }
}

describe("parse424bFiling with real SEC source filings", () => {
  it("uses full SEC Archives document text fixed in JSON fixtures, not excerpts or live fetches", () => {
    for (const name of allRealFixtureNames()) {
      const fixture = loadRealFixture(name);

      assert.ok(fixture.sourceUrl.startsWith("https://www.sec.gov/Archives/edgar/data/"));
      assert.ok(
        fixture.fixtureSource.source.startsWith("SEC Archives original"),
        `${name} should come from SEC Archives original source`,
      );
      assert.ok(fixture.filingText.includes("<DOCUMENT>"), `${name} should include the SEC document wrapper`);
      assert.ok(fixture.filingText.includes("<TEXT>"), `${name} should include the SEC text wrapper`);
      assert.ok(fixture.filingText.length > 5_000, `${name} should contain original filing text, not a hand excerpt`);
    }
  });

  it("extracts ATM raw terms from the real Silvaco 424B5 without unrelated variant noise", () => {
    const output = parse424bFiling(loadRealFixture("silvaco-424b5-2026-05-22"));
    const parsedFacts = facts(output);

    assert.equal(parsedFacts.prospectusClass, "at_the_market");
    assert.deepEqual(parsedFacts.offeringTerms.maxOfferingAmount, 4_331_280);
    assert.equal(parsedFacts.offeringTerms.atTheMarket, true);
    assert.equal(parsedFacts.issuer.ticker, "SVCO");
    assert.deepEqual(output.warnings, []);

    assertAllNullish(parsedFacts.preferredTerms, ["depositaryShareCount", "liquidationPreferencePerPreferredShare"]);
    assertAllNullish(parsedFacts.rightsOfferingTerms, ["rightsCount", "sharesIssuable"]);
    assertAllNullish(parsedFacts.structuredNoteTerms, ["principalAmount", "referenceTicker"]);
    assertAllNullish(parsedFacts.multiLegWarrantTerms, ["preFundedWarrants", "commonWarrants"]);
  });

  it("extracts resale and pre-funded warrant raw terms from the real iBio 424B3", () => {
    const output = parse424bFiling(loadRealFixture("ibio-424b3-2026-01-30"));
    const parsedFacts = facts(output);

    assert.equal(parsedFacts.prospectusClass, "multi_leg_warrant");
    assert.equal(parsedFacts.offeringTerms.warrantsOffered, 9_653_257);
    assert.equal(parsedFacts.offeringTerms.grossProceeds, 26_000_000);
    assert.equal(parsedFacts.offeringTerms.noCompanyProceeds, true);
    assert.equal(parsedFacts.multiLegWarrantTerms.preFundedWarrants, 9_653_257);
    assert.equal(parsedFacts.multiLegWarrantTerms.preFundedWarrantExercisePrice, 0.001);
    assert.equal(parsedFacts.multiLegWarrantTerms.ownershipCapPercent, 9.99);

    assertAllNullish(parsedFacts.preferredTerms, ["depositaryShareCount", "liquidationPreferencePerPreferredShare"]);
    assertAllNullish(parsedFacts.rightsOfferingTerms, ["rightsCount", "sharesIssuable"]);
    assertAllNullish(parsedFacts.structuredNoteTerms, ["principalAmount", "referenceTicker"]);
  });

  it("extracts common-stock raw terms from the real Red Cat 424B5 and avoids non-present security buckets", () => {
    const output = parse424bFiling(loadRealFixture("red-cat-424b5-2026-05-18"));
    const parsedFacts = facts(output);
    const sourceTextStats = output.raw.sourceTextStats as { extractionWasWindowed?: boolean };

    assert.equal(parsedFacts.offeringTerms.sharesOffered, 23_936_171);
    assert.equal(parsedFacts.offeringTerms.netProceeds, 213_300_000);
    assert.equal(parsedFacts.offeringTerms.atTheMarket, false);
    assert.equal(parsedFacts.issuer.ticker, "RCAT");
    assert.equal(sourceTextStats.extractionWasWindowed, true);
    assert.deepEqual(output.warnings, []);

    assertAllNullish(parsedFacts.preferredTerms, ["depositaryShareCount", "liquidationPreferencePerPreferredShare"]);
    assertAllNullish(parsedFacts.rightsOfferingTerms, ["rightsCount", "sharesIssuable"]);
    assertAllNullish(parsedFacts.structuredNoteTerms, ["issuer", "principalAmount", "referenceTicker"]);
    assertAllNullish(parsedFacts.multiLegWarrantTerms, ["preFundedWarrants", "commonWarrants"]);
  });

  it("keeps ATM post-offering share assumptions separate from actual offered supply in the real Anteris 424B5", () => {
    const output = parse424bFiling(loadRealFixture("anteris-424b5-2026-05-22"));
    const parsedFacts = facts(output);
    const signalNames = output.signals.map((signal) => signal.name);

    assert.equal(parsedFacts.prospectusClass, "at_the_market");
    assert.equal(parsedFacts.offeringTerms.maxOfferingAmount, 250_000_000);
    assert.equal(parsedFacts.offeringTerms.atTheMarket, true);
    assert.equal(parsedFacts.offeringTerms.sharesOffered, null);
    assert.equal(parsedFacts.offeringTerms.pricePerShare, null);
    assert.equal(parsedFacts.offeringTerms.grossProceeds, null);
    assert.equal(parsedFacts.offeringTerms.netProceeds, null);
    assert.equal(parsedFacts.offeringTerms.assumedSharesSold, 27_777_777);
    assert.equal(parsedFacts.offeringTerms.assumedOfferingPrice, 9);
    assert.equal(parsedFacts.capitalization.sharesOutstanding, 97_232_054);
    assert.equal(
      (output.raw.atmShareAssumption as { postOfferingShareCountAssumptionNotSupply?: number | null })
        .postOfferingShareCountAssumptionNotSupply,
      125_009_831,
    );

    assert.equal(
      (parsedFacts.securitiesOffered as Array<{ securityType?: string; amount?: number }>).some(
        (security) => security.amount === 125_009_831,
      ),
      false,
      "post-offering shares must not become offered/resale/security supply",
    );
    assert.equal(signalNames.includes("rights_offering"), false);
    assert.equal(signalNames.includes("preferred_depositary_security"), false);
    assert.equal(signalNames.includes("selling_stockholder_resale"), false);
    assertAllNullish(parsedFacts.preferredTerms, ["depositaryShareCount", "liquidationPreferencePerPreferredShare"]);
    assertAllNullish(parsedFacts.rightsOfferingTerms, ["rightsCount", "sharesIssuable"]);
  });

  it("keeps non-affiliate float separate from total shares outstanding in the real Shimmick ATM amendment", () => {
    const output = parse424bFiling(loadRealFixture("shimmick-atm-amendment-424b5-2026-05-22"));
    const parsedFacts = facts(output);

    assert.equal(parsedFacts.prospectusClass, "at_the_market");
    assert.equal(parsedFacts.offeringTerms.maxOfferingAmount, 4_986_750);
    assert.equal(parsedFacts.offeringTerms.atTheMarket, true);
    assert.equal(parsedFacts.offeringTerms.sharesOffered, null);
    assert.equal(parsedFacts.capitalization.sharesOutstanding, null);
    assert.equal(parsedFacts.capitalization.publicFloat, 8_278_806);
    assert.equal(
      (parsedFacts.securitiesOffered as Array<{ securityType?: string; amount?: number }>).some(
        (security) => security.amount === 8_278_806,
      ),
      false,
      "non-affiliate float must not become registered or offered supply",
    );
    assert.deepEqual(output.warnings, []);
  });
});
