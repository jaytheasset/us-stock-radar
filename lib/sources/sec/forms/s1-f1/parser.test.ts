import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SecFormParserInput } from "../common/parserContract";
import { parseSecS1F1Filing } from "./parser";

const fixtureDir = resolve(process.cwd(), "lib", "sources", "sec", "forms", "s1-f1", "fixtures");

const ipo = parseSecS1F1Filing(loadFixture("ipo-primary.json"));
assert.equal(ipo.isSupported, true);
assert.equal(ipo.facts.terms.offering_kind.value, "ipo_listing");
assert.equal(ipo.facts.terms.shares_offered?.value, 3_000_000);
assert.equal(ipo.facts.terms.price_range?.value.low, 4);
assert.equal(ipo.facts.terms.price_range?.value.high, 6);
assert.equal(ipo.facts.terms.fee_table.present, true);
assert.ok(ipo.calendarItems?.some((item) => item.calendarEventType === "ipo_pricing_date"));
assert.ok(ipo.calendarItems?.some((item) => item.calendarEventType === "ipo_listing_date"));

const resale = parseSecS1F1Filing(loadFixture("resale-registration.json"));
assert.equal(resale.isSupported, true);
assert.equal(resale.facts.terms.offering_kind.value, "resale_registration");
assert.equal(resale.facts.terms.primary_or_resale?.value, "resale");
assert.equal(resale.facts.terms.resale_share_count?.value, 5_000_000);
assert.equal(resale.facts.terms.selling_stockholders.length, 2);
assert.ok(resale.signals?.includes("resale_overhang_candidate"));

const primaryAmendment = parseSecS1F1Filing(loadFixture("primary-follow-on-amendment.json"));
assert.equal(primaryAmendment.isSupported, true);
assert.equal(primaryAmendment.facts.amendment.is_amendment, true);
assert.equal(primaryAmendment.facts.amendment.amendment_number?.value, 2);
assert.equal(primaryAmendment.facts.terms.offering_kind.value, "primary_registration");
assert.equal(primaryAmendment.facts.terms.primary_shares_offered?.value, 2_500_000);
assert.equal(primaryAmendment.facts.terms.offering_price?.value.price, 3.5);
assert.ok(primaryAmendment.calendarItems?.some((item) => item.calendarEventType === "offering_closing"));

console.log(
  JSON.stringify(
    {
      ok: true,
      parser_version: ipo.facts.parser_version,
      fixtures: ["ipo-primary", "resale-registration", "primary-follow-on-amendment"],
    },
    null,
    2,
  ),
);

function loadFixture(filename: string): SecFormParserInput {
  return JSON.parse(readFileSync(resolve(fixtureDir, filename), "utf8")) as SecFormParserInput;
}
